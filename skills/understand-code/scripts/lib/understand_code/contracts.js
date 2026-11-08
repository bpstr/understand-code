/** Closed JSON Schema subset. No network schemas or executable extensions. */
import fs from 'node:fs';
import { canonical_json } from './ontology.js';
export function check(value, schema, location = 'finding') {
    const kind = schema.type;
    const matches = { object: value !== null && typeof value === 'object' && !Array.isArray(value),
        array: Array.isArray(value), string: typeof value === 'string', integer: Number.isSafeInteger(value), boolean: typeof value === 'boolean' };
    if (kind && !matches[kind])
        throw new Error(`${location}: expected ${kind}`);
    if ('enum' in schema && !schema.enum.some((item) => canonical_json(item) === canonical_json(value)))
        throw new Error(`${location}: value outside allowed vocabulary`);
    if ('const' in schema && canonical_json(value) !== canonical_json(schema.const))
        throw new Error(`${location}: unexpected constant`);
    if (typeof value === 'string') {
        const length = Array.from(value).length;
        if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? 1e9))
            throw new Error(`${location}: string length outside contract`);
        if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
            throw new Error(`${location}: invalid string format`);
    }
    if (Number.isSafeInteger(value) && (value < (schema.minimum ?? value) || value > (schema.maximum ?? value)))
        throw new Error(`${location}: integer outside contract`);
    if (Array.isArray(value)) {
        if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 1e9))
            throw new Error(`${location}: array length outside contract`);
        if (schema.uniqueItems && new Set(value.map(v => canonical_json(v))).size !== value.length)
            throw new Error(`${location}: duplicate items`);
        value.forEach((item, i) => check(item, schema.items ?? {}, `${location}[${i}]`));
    }
    else if (value !== null && typeof value === 'object') {
        const missing = (schema.required ?? []).filter((key) => !Object.hasOwn(value, key));
        if (missing.length)
            throw new Error(`${location}: missing ${canonical_json(missing.sort())}`);
        const properties = schema.properties ?? {}, additional = schema.additionalProperties ?? true;
        for (const [key, item] of Object.entries(value)) {
            if (Object.hasOwn(properties, key))
                check(item, properties[key], `${location}.${key}`);
            else if (additional === false)
                throw new Error(`${location}: unsupported field ${key}`);
            else if (typeof additional === 'object')
                check(item, additional, `${location}.${key}`);
        }
    }
}
export function validate_contract(name, value) {
    if (!/^[a-z-]+$/.test(name))
        throw new Error('Invalid contract name');
    const schema = JSON.parse(fs.readFileSync(new URL(`./resources/${name}.schema.json`, import.meta.url), 'utf8'));
    check(value, schema, name);
}
export function validate_finding(value) { validate_contract('finding', value); }
