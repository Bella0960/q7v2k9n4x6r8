/**
 * 0008_context_source_device — bind the latest role-context revision to the
 * authenticated device that reported it, without storing any context content.
 */
export const VERSION = '0008_context_source_device';

export const SQL = `
ALTER TABLE character_context_versions ADD COLUMN updated_by_device_id TEXT;
`;
