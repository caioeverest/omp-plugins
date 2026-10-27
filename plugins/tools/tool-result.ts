export function toolText(text: string, isError = false) {
	return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}
