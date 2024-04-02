#!/usr/bin/env node
import ora from 'ora';
import {
	loadConfiguration,
	getAccessToken,
	getAccountCallHistory,
	processCallLogs,
	generateReport
} from './zoom.js';
import {getFromDate, getToDate} from './prompts.js';

const zoom = new Object();
await loadConfiguration(zoom);
await getAccessToken(zoom);

const spinner = ora();
spinner.start('Verifying scopes');
if (
	!(
		zoom.scope.includes('phone:read:admin') ||
		zoom.scope.includes('phone_call_log:read:admin') ||
		zoom.scope.includes('phone:read:list_call_logs:admin')
	)
) {
	spinner.fail('Scope not found.  Check app configuration.');
	process.exit(0);
}
spinner.succeed();

console.log(
	'The date range defined by the from and to parameters should be less than or equal to a month in duration. The month defined should fall within the last six months.'
);
const fromDate = await getFromDate();
const toDate = await getToDate(fromDate);

spinner.start('Getting call logs');
const call_logs = await getAccountCallHistory(
	zoom.access_token,
	fromDate,
	toDate,
	[]
);
spinner.succeed();

spinner.start('Processing call logs');
const processed_call_logs = await processCallLogs(zoom, call_logs, spinner);
spinner.succeed();

spinner.start('Generating report');
const report = await generateReport(processed_call_logs);
spinner.succeed();

// do something with the report
console.log(JSON.stringify({report}, null, 2));
