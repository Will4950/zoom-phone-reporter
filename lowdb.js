import {JSONFilePreset} from 'lowdb/node';
import _ from 'underscore';

const db = await JSONFilePreset('config.json', {
	information: 'Values must be base64 encoded',
	keys: {}
});
await db.read();

export const {keys} = db.data;

export async function setKey(key, value) {
	value === null
		? delete keys[key]
		: (keys[key] = Buffer.from(value).toString('base64'));
	await db.write();
}

export function getKey(val) {
	if (!_.isString(keys[val])) return null;
	return Buffer.from(keys[val], 'base64').toString('ascii');
}
