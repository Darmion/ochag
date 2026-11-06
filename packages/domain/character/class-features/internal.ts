export function knownChoices(sheetExtra: any, key: string, list: ReadonlyArray<{ id: string; pattern: RegExp }>): string[] {
  const marked = Array.isArray(sheetExtra?.[key]) ? sheetExtra[key].map(String) : [];
  const text = JSON.stringify(sheetExtra?.text ?? {});
  return list.filter(entry => marked.includes(entry.id) || (!Array.isArray(sheetExtra?.[key]) && entry.pattern.test(text))).map(entry => entry.id);
}
