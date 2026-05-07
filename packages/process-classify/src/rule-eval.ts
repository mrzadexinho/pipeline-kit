export interface ClassifyRule {
  field: string;
  match: 'equals' | 'contains' | 'regex' | 'gt' | 'lt';
  value: unknown;
  category: string;
  priority?: number;
}

function getNestedProperty(obj: Record<string, unknown>, key: string): unknown {
  // Using hasOwnProperty to prevent prototype pollution attacks via property access
  // biome-ignore lint/suspicious/noPrototypeBuiltins: required for safe property access
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

export function resolvePath(obj: unknown, path: string): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = getNestedProperty(current as Record<string, unknown>, part);
  }

  return current;
}

function compileRegex(pattern: string): RegExp | null {
  try {
    // WARNING: Pattern comes from trusted config (ClassifyRule), not user input.
    // This is safe because rules are set at pipeline construction time by the app,
    // not from untrusted sources. The caller must validate rules before config creation.
    // eslint-disable-next-line security/detect-non-literal-regexp
    return new RegExp(pattern); // nosemgrep
  } catch {
    return null;
  }
}

export function evalRule(rule: ClassifyRule, input: unknown): boolean {
  const resolved = resolvePath(input, rule.field);

  switch (rule.match) {
    case 'equals':
      return resolved === rule.value;

    case 'contains':
      return String(resolved).includes(String(rule.value));

    case 'regex': {
      const regex = compileRegex(String(rule.value));
      return regex?.test(String(resolved)) ?? false;
    }

    case 'gt':
      return Number(resolved) > Number(rule.value);

    case 'lt':
      return Number(resolved) < Number(rule.value);

    default:
      return false;
  }
}
