/**
 * The `next` path after sign-in, only if it is a same-site relative path; otherwise `/`.
 * Refuses `//host`, `/\host` and anything with control characters (browsers drop tabs and line breaks
 * inside URLs, so `/\t/host` would become `//host`). Prevents open redirects.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  const hasControlCharacter = [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return hasControlCharacter ? '/' : value;
}
