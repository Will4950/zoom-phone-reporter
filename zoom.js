import _ from 'underscore';
import ora from 'ora';

import {getKey, setKey} from './lowdb.js';
import {confirmContinue, enterConfigValue} from './prompts.js';

const zoomOAuth = 'https://zoom.us/oauth';
const zoomAPI = 'https://api.zoom.us/v2';

export async function loadConfiguration(zoom) {
	const spinner = ora();
	spinner.start('Loading configuration');
	zoom.accountId = getKey('accountId');
	zoom.clientId = getKey('clientId');
	zoom.clientSecret = getKey('clientSecret');

	const configFound =
		_.isEmpty(zoom.accountId) ||
		_.isEmpty(zoom.clientId) ||
		_.isEmpty(zoom.clientSecret)
			? false
			: true;

	if (configFound) {
		spinner.succeed();
		if (await confirmContinue('Continue with existing configuration?')) {
			return zoom;
		} else {
			await setKey('accountId', null);
			await setKey('clientId', null);
			await setKey('clientSecret', null);
			console.log('Existing configuration removed');
			await loadConfiguration(zoom);
		}
	} else {
		spinner.fail('Configuration not found');
		await enterConfigValue('accountId');
		await enterConfigValue('clientId');
		await enterConfigValue('clientSecret');
		await loadConfiguration(zoom);
	}
}

export async function getAccessToken(zoom) {
	const spinner = ora();
	spinner.start('Retrieving Access Token');

	const res = await fetch(
		`${zoomOAuth}/token?grant_type=account_credentials&account_id=${zoom.accountId}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Basic ${Buffer.from(`${zoom.clientId}:${zoom.clientSecret}`, 'utf-8').toString('base64')}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			}
		}
	);

	if (res.ok) {
		spinner.succeed();
		const data = await res.json();
		zoom.access_token = data.access_token;
		zoom.scope = data.scope;
		return data.access_token;
	} else {
		spinner.fail('Unable to get access_token.  Check configuration.');
		process.exit();
	}
}

export async function getAccountCallHistory(
	access_token,
	from,
	to,
	history,
	next_page_token
) {
	const res = await fetch(
		`${zoomAPI}/phone/call_history?page_size=300&from=${from}&to=${to}${next_page_token ? `&next_page_token=${next_page_token}` : ''}`,
		{
			method: 'GET',
			headers: {
				Authorization: `Bearer ${access_token}`,
				'Content-Type': 'application/json'
			}
		}
	);

	const data = await res.json();
	history = history.concat(data.call_logs);
	if (data.next_page_token) {
		return await getAccountCallHistory(
			access_token,
			from,
			to,
			history,
			data.next_page_token
		);
	} else {
		return history;
	}
}

export async function getCallPath(access_token, call_log_id) {
	const res = await fetch(`${zoomAPI}/phone/call_history/${call_log_id}`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${access_token}`,
			'Content-Type': 'application/json'
		}
	});

	return res.json();
}

export async function processCallLogs(zoom, call_logs) {
	const processed_call_logs = {
		inbounds: [],
		outbounds: []
	};

	for (const log in call_logs) {
		if (
			call_logs[log].direction === 'inbound' &&
			call_logs[log].call_result === 'answered' &&
			call_logs[log].connect_type === 'external'
		) {
			processed_call_logs.inbounds.push(call_logs[log]);
		}

		if (
			call_logs[log].direction === 'outbound' &&
			call_logs[log].call_result === 'connected' &&
			call_logs[log].connect_type === 'external'
		) {
			const outboundCallPath = await getCallPath(
				zoom.access_token,
				call_logs[log].id
			);

			// masked caller id check and handler
			if (_.isEmpty(outboundCallPath.call_path[0].operator_ext_number)) {
				processed_call_logs.outbounds.push(call_logs[log]);
			} else {
				processed_call_logs.outbounds.push({
					...call_logs[log],
					caller_name: outboundCallPath.call_path[0].operator_name,
					caller_ext_id: outboundCallPath.call_path[0].operator_ext_id,
					caller_ext_number: outboundCallPath.call_path[0].operator_ext_number,
					caller_email: outboundCallPath.call_path[1].caller_email
				});
			}
		}
	}

	const internalReps1 = _.where(call_logs, {
		direction: 'outbound',
		call_result: 'connected',
		connect_type: 'internal'
	});

	const internalReps2 = _.where(call_logs, {
		direction: 'inbound',
		call_result: 'answered',
		connect_type: 'internal'
	});

	processed_call_logs.reptorep = internalReps1.concat(internalReps2);
	processed_call_logs.groupedreptorep = _.groupBy(
		processed_call_logs.reptorep,
		'call_id'
	);

	for (const call in processed_call_logs.inbounds) {
		const call_start_time = new Date(
			processed_call_logs.inbounds[call].start_time
		).getTime();
		const call_end_time = new Date(
			processed_call_logs.inbounds[call].end_time
		).getTime();
		const callee_ext_number =
			processed_call_logs.inbounds[call].callee_ext_number;

		const call_leg = _.find(processed_call_logs.reptorep, (leg) => {
			const leg_caller_ext_number = leg.caller_ext_number;
			const leg_answer_time = new Date(leg.answer_time).getTime();
			return (
				leg_answer_time > call_start_time &&
				leg_answer_time < call_end_time &&
				callee_ext_number === leg_caller_ext_number
			);
		});

		if (call_leg) {
			processed_call_logs.groupedreptorep[call_leg.call_id].push(
				processed_call_logs.inbounds[call]
			);
			processed_call_logs.inbounds[call].matched = true;
			continue;
		}
		processed_call_logs.inbounds[call].matched = false;
	}

	processed_call_logs.inbounds = _.where(processed_call_logs.inbounds, {
		matched: false
	});

	for (const call in processed_call_logs.outbounds) {
		const call_start_time = new Date(
			processed_call_logs.outbounds[call].start_time
		).getTime();
		const call_end_time = new Date(
			processed_call_logs.outbounds[call].end_time
		).getTime();
		const caller_ext_number =
			processed_call_logs.outbounds[call].caller_ext_number;

		const call_leg = _.find(processed_call_logs.reptorep, (leg) => {
			const leg_start_time = new Date(leg.start_time).getTime();
			const leg_end_time = new Date(leg.end_time).getTime();
			const leg_caller_ext_number = leg.caller_ext_number;
			return (
				leg_start_time < call_start_time &&
				leg_end_time > call_end_time &&
				caller_ext_number === leg_caller_ext_number
			);
		});

		if (call_leg) {
			processed_call_logs.groupedreptorep[call_leg.call_id].push(
				processed_call_logs.outbounds[call]
			);
			processed_call_logs.outbounds[call].matched = true;
			continue;
		}
		processed_call_logs.outbounds[call].matched = false;
	}

	processed_call_logs.outbounds = _.where(processed_call_logs.outbounds, {
		matched: false
	});

	return processed_call_logs;
}

export async function generateReport(processed_call_logs) {
	const report = [];

	const inbounds = processed_call_logs.inbounds;
	for (const inbound in inbounds) {
		report.push([
			{
				rep_ext: inbounds[inbound].callee_ext_number,
				rep_email: inbounds[inbound].callee_email,
				customer_did: inbounds[inbound].caller_did_number,
				duration: inbounds[inbound].duration
			}
		]);
	}

	const outbounds = processed_call_logs.outbounds;
	for (const outbound in outbounds) {
		report.push([
			{
				rep_ext: outbounds[outbound].caller_ext_number,
				rep_email: outbounds[outbound].caller_email,
				customer_did: outbounds[outbound].callee_did_number,
				duration: outbounds[outbound].duration
			}
		]);
	}

	const call_logs = processed_call_logs.groupedreptorep;
	for (const call in call_logs) {
		const items = [];
		const internal_calls = _.where(call_logs[call], {connect_type: 'internal'});
		const external_calls = _.where(call_logs[call], {connect_type: 'external'});

		for (const leg in external_calls) {
			if (external_calls[leg].direction === 'outbound') {
				for (const rep in internal_calls) {
					if (internal_calls[rep].direction === 'outbound') {
						items.push({
							rep_ext: internal_calls[rep].caller_ext_number,
							rep_email: internal_calls[rep].caller_email,
							customer_did: external_calls[leg].callee_did_number,
							duration: external_calls[leg].duration
						});
					} else {
						items.push({
							rep_ext: internal_calls[rep].callee_ext_number,
							rep_email: internal_calls[rep].callee_email,
							customer_did: external_calls[leg].callee_did_number,
							duration: external_calls[leg].duration
						});
					}
				}
			} else if (external_calls[leg].direction === 'inbound') {
				for (const rep in internal_calls) {
					if (internal_calls[rep].direction === 'outbound') {
						items.push({
							rep_ext: internal_calls[rep].caller_ext_number,
							rep_email: internal_calls[rep].caller_email,
							customer_did: external_calls[leg].caller_did_number,
							duration: external_calls[leg].duration
						});
					} else {
						items.push({
							rep_ext: internal_calls[rep].callee_ext_number,
							rep_email: internal_calls[rep].callee_email,
							customer_did: external_calls[leg].caller_did_number,
							duration: internal_calls[rep].duration
						});
					}
				}
			}
		}

		if (items.length > 0) report.push([items]);
	}

	return report;
}
