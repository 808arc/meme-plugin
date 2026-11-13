/** True when a file-system error means "the file does not exist". Shared so
 * every read-with-fallback site checks the same way. */
export const isMissingFile = (error: unknown): boolean =>
	(error as NodeJS.ErrnoException).code === "ENOENT";
