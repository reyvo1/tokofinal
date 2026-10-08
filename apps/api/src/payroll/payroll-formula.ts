export type PayrollFormulaVariables = Record<string, number>;

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' | 'rparen' | 'comma' };

const MAX_EXPRESSION_LENGTH = 256;
const MAX_TOKENS = 128;
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: (...values) => Math.min(...values),
  max: (...values) => Math.max(...values),
  round: (value) => Math.round(value),
  floor: (value) => Math.floor(value),
  ceil: (value) => Math.ceil(value),
  abs: (value) => Math.abs(value),
};

function tokenize(expression: string): Token[] {
  if (!expression.trim()) throw new Error('formula-empty');
  if (expression.length > MAX_EXPRESSION_LENGTH) throw new Error('formula-too-long');
  const tokens: Token[] = [];
  let index = 0;
  const push = (token: Token) => {
    tokens.push(token);
    if (tokens.length > MAX_TOKENS) throw new Error('formula-too-complex');
  };
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[0-9.]/.test(char)) {
      const start = index;
      let dots = 0;
      while (index < expression.length && /[0-9.]/.test(expression[index])) {
        if (expression[index] === '.') dots += 1;
        index += 1;
      }
      if (dots > 1) throw new Error('invalid-number');
      const value = Number(expression.slice(start, index));
      if (!Number.isFinite(value)) throw new Error('invalid-number');
      push({ type: 'number', value });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < expression.length && /[A-Za-z0-9_.]/.test(expression[index])) index += 1;
      push({ type: 'identifier', value: expression.slice(start, index) });
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/') push({ type: 'operator', value: char });
    else if (char === '(') push({ type: 'lparen' });
    else if (char === ')') push({ type: 'rparen' });
    else if (char === ',') push({ type: 'comma' });
    else throw new Error(`invalid-token:${char}`);
    index += 1;
  }
  return tokens;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly variables: PayrollFormulaVariables;
  constructor(tokens: Token[], variables: PayrollFormulaVariables) { this.tokens = tokens; this.variables = variables; }

  parse(): number {
    const value = this.expression();
    if (this.index !== this.tokens.length) throw new Error('unexpected-token');
    return this.checked(value);
  }

  private expression(): number {
    let value = this.term();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = (this.tokens[this.index - 1] as Extract<Token, { type: 'operator' }>).value;
      const right = this.term();
      value = operator === '+' ? value + right : value - right;
      value = this.checked(value);
    }
    return value;
  }

  private term(): number {
    let value = this.unary();
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const operator = (this.tokens[this.index - 1] as Extract<Token, { type: 'operator' }>).value;
      const right = this.unary();
      if (operator === '/' && right === 0) throw new Error('division-by-zero');
      value = operator === '*' ? value * right : value / right;
      value = this.checked(value);
    }
    return value;
  }

  private unary(): number {
    if (this.matchOperator('+')) return this.unary();
    if (this.matchOperator('-')) return this.checked(-this.unary());
    return this.primary();
  }

  private primary(): number {
    const token = this.tokens[this.index];
    if (!token) throw new Error('unexpected-end');
    if (token.type === 'number') { this.index += 1; return token.value; }
    if (token.type === 'lparen') {
      this.index += 1;
      const value = this.expression();
      if (this.tokens[this.index]?.type !== 'rparen') throw new Error('missing-rparen');
      this.index += 1;
      return value;
    }
    if (token.type === 'identifier') {
      this.index += 1;
      if (this.tokens[this.index]?.type === 'lparen') return this.functionCall(token.value);
      if (!(token.value in this.variables)) throw new Error(`unknown-variable:${token.value}`);
      return this.checked(this.variables[token.value]);
    }
    throw new Error('unexpected-token');
  }

  private functionCall(name: string): number {
    const fn = FUNCTIONS[name.toLowerCase()];
    if (!fn) throw new Error(`unknown-function:${name}`);
    this.index += 1; // (
    const args: number[] = [];
    if (this.tokens[this.index]?.type !== 'rparen') {
      do { args.push(this.expression()); } while (this.match('comma'));
    }
    if (this.tokens[this.index]?.type !== 'rparen') throw new Error('missing-rparen');
    this.index += 1;
    if (['round','floor','ceil','abs'].includes(name.toLowerCase()) && args.length !== 1) throw new Error(`invalid-arity:${name}`);
    if (['min','max'].includes(name.toLowerCase()) && args.length < 1) throw new Error(`invalid-arity:${name}`);
    return this.checked(fn(...args));
  }

  private match(type: Token['type']): boolean {
    if (this.tokens[this.index]?.type !== type) return false;
    this.index += 1; return true;
  }

  private matchOperator(value: '+' | '-' | '*' | '/'): boolean {
    const token = this.tokens[this.index];
    if (token?.type !== 'operator' || token.value !== value) return false;
    this.index += 1; return true;
  }

  private checked(value: number): number {
    if (!Number.isFinite(value)) throw new Error('non-finite-result');
    if (Math.abs(value) > 1_000_000_000_000) throw new Error('result-out-of-range');
    return value;
  }
}

export function evaluatePayrollFormula(expression: string, variables: PayrollFormulaVariables): number {
  return new Parser(tokenize(expression), variables).parse();
}
