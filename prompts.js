import prompts from 'prompts';
import {setKey} from './lowdb.js';

const onCancel = () => {
	process.exit();
};

export async function enterConfigValue(value) {
	await prompts(
		{
			type: 'text',
			message: `Enter your ${value}`,
			name: 'res'
		},
		{
			onSubmit: async (prompt, answer) => {
				await setKey(value, answer);
			},
			onCancel
		}
	);
}

export async function getFromDate() {
	const answer = await prompts(
		{
			type: 'date',
			message: 'Enter the start date and time [from]',
			initial: new Date(),
			name: 'date',
			validate: (date) => {
				const now = new Date();
				const sixMonthsAgo = new Date().setMonth(new Date().getMonth() - 6);
				if (date >= now) return 'Date must be in the past';
				if (date <= sixMonthsAgo)
					return 'Date must be within the last 6 months';
				return true;
			}
		},
		{
			onCancel
		}
	);
	let date = answer.date.toISOString();
	date = `${date.slice(0, date.length - 5)}Z`;
	return date;
}

export async function getToDate(compare) {
	const answer = await prompts(
		{
			type: 'date',
			message: 'Enter the end date and time [to]',
			initial: new Date(),
			name: 'date',
			validate: (date) => {
				const farthestDate = new Date(compare).setMonth(
					new Date(compare).getMonth() + 1
				);
				if (date <= compare) return 'To date must be before from date';
				if (date >= farthestDate)
					return 'To date must be within one month of from date';
				return true;
			}
		},
		{
			onCancel
		}
	);

	let date = answer.date.toISOString();
	date = `${date.slice(0, date.length - 5)}Z`;
	return date;
}

export async function confirmContinue(message) {
	const confirm = await prompts(
		{
			type: 'confirm',
			name: 'value',
			message,
			initial: true
		},
		{
			onCancel
		}
	);
	return confirm.value;
}
