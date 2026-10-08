// Payload-vs-DTO parity, computed from the real TypeScript AST.
//
// forbidNonWhitelisted is on (apps/api/src/main.ts:33), so a key the DTO does not declare is a
// hard 400 at runtime — not a cosmetic mismatch. A (method, path) parity audit cannot see this:
// the route pair is byte-identical whether the body is right or wrong. That is exactly why the
// defect the user found in HR/Payroll ("pembaruan shift mengirim seluruh objek respons") survived
// a green route audit.
//
// A regex version of this scan was written first and produced wrong answers, each time silently:
// a fictional 239-route "missing form" report, then a fictional 9-key finding. Four parser defects
// had to be fixed first, all of which surfaced as clean or wrong output rather than as errors:
//   1. a decorated regex for DTO properties backtracked exponentially on @Transform(({ obj }) …)
//   2. `while (re.exec())` without the /g flag looped forever on the same index
//   3. a signature regex /\(([^)]*)\)/ cannot match a parameter list containing @Body()
//   4. DTO `extends` was ignored, so every inherited field looked like an unknown key
// Every one of those is now guarded by an anti-vacuity assertion in the report block below.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('../../', import.meta.url).pathname;
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const listFiles = (dir, exts) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p);
const parse = (file) => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

const textOf = (src) => (n) => (n ? n.getText(src) : '');
const decoratorsOf = (node) => ts.canHaveDecorators?.(node) ? (ts.getDecorators(node) ?? []) : [];

// ------------------------------------------------------------------ DTO properties
const dtoMap = new Map();
for (const file of listFiles(path.join(ROOT, 'apps/api/src'), ['.dto.ts'])) {
  const src = parse(file);
  textOf(src);
  for (const stmt of src.statements) {
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
    if (!stmt.name.text.endsWith('Dto')) continue;
    const props = new Set();
    for (const member of stmt.members) {
      if (ts.isPropertyDeclaration(member) && member.name) {
        const n = member.name;
        props.add(ts.isIdentifier(n) ? n.text : n.getText(src));
      }
    }
    dtoMap.set(stmt.name.text, { props, file: rel(file) });
  }
}

// ------------------------------------------------------------------ controller routes
const routes = [];
for (const file of listFiles(path.join(ROOT, 'apps/api/src'), ['.controller.ts'])) {
  const src = parse(file);
  for (const stmt of src.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;

    let prefix = '';
    let classRoles = [];
    let classPerms = [];
    for (const dec of decoratorsOf(stmt)) {
      const t = dec.expression;
      if (!ts.isCallExpression(t) || !ts.isIdentifier(t.expression)) continue;
      const name = t.expression.text;
      const args = t.arguments.map((a) => a.getText(src));
      if (name === 'Controller') prefix = (args[0] ?? '').replace(/['"]/g, '');
      if (name === 'Roles') classRoles = args.join(',').replace(/['"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      if (name === 'Permissions') classPerms = args.join(',').replace(/['"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    }

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue;
      let http = null;
      let perms = classPerms;
      let roles = classRoles;
      let dto = null;

      for (const dec of decoratorsOf(member)) {
        const t = dec.expression;
        if (!ts.isCallExpression(t) || !ts.isIdentifier(t.expression)) continue;
        const name = t.expression.text;
        const args = t.arguments.map((a) => a.getText(src));
        if (/^(Get|Post|Patch|Put|Delete)$/.test(name)) http = { method: name.toUpperCase(), sub: (args[0] ?? '').replace(/['"]/g, '') };
        if (name === 'Roles') roles = args.join(',').replace(/['"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        if (name === 'Permissions') perms = args.join(',').replace(/['"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (!http) continue;

      for (const p of member.parameters) {
        const decs = decoratorsOf(p);
        for (const dec of decs) {
          const t = dec.expression;
          if (ts.isCallExpression(t) && ts.isIdentifier(t.expression) && t.expression.text === 'Body') {
            if (p.type && ts.isTypeReferenceNode(p.type) && p.type.typeName.getText(src).endsWith('Dto')) {
              dto = p.type.typeName.getText(src);
            }
          }
        }
      }

      // Controller params are :id / :productId; collapse them to the same token the UI side uses so
      // /assets/:p/assign matches /assets/${id}/assign. Position is what matters, not the name.
      const full = `/${prefix}/${http.sub}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      const routePath = full.split('/').filter((s) => s.length).map((s) => (/^:/.test(s) ? ':p' : s)).reduce((a, s) => a + '/' + s, '');
      routes.push({ method: http.method, path: routePath, rawPath: full, dto, perms, roles, file: rel(file), line: src.getLineAndCharacterOfPosition(member.getStart()).line + 1 });
    }
  }
}

// A DTO may extend another. NestJS ValidationPipe validates the INHERITED properties too, so a
// PATCH against UpdateAttendancePolicyDto legitimately sends code/name/allowedMethods from
// CreateAttendancePolicyDto. Without resolving `extends`, every inherited field looks like an
// unknown key — which produced three false "payload will 400" findings.
const heritage = new Map();
for (const file of listFiles(path.join(ROOT, 'apps/api/src'), ['.dto.ts'])) {
  const src = parse(file);
  for (const stmt of src.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name && stmt.heritageClauses) {
      for (const h of stmt.heritageClauses) {
        if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const t of h.types) {
          const n = t.expression.getText();
          if (n.endsWith('Dto')) heritage.set(stmt.name.text, n);
        }
      }
    }
  }
}

// Properties of a DTO, including everything it inherits, resolved transitively.
const propsOf = (name, seen = new Set()) => {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const out = new Set(dtoMap.get(name)?.props ?? []);
  const parent = heritage.get(name);
  if (parent && dtoMap.has(parent)) for (const k of propsOf(parent, seen)) out.add(k);
  return out;
};
const UI_ROOTS = ['apps/admin/app', 'apps/pos/app', 'apps/storefront/app', 'apps/employee-portal/app'];
const sites = [];
const resolvedFromState = new Set();
for (const r of UI_ROOTS) {
  for (const file of listFiles(path.join(ROOT, r), ['.tsx', '.ts'])) {
    const src = parse(file);

    // Collect string-literal-ish template expressions so /orders/${id}/${action} can be resolved.
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        let fnName = null;
        if (ts.isIdentifier(node.expression)) fnName = node.expression.text;
        else if (ts.isPropertyAccessExpression(node.expression)) fnName = node.expression.name.text;
        if (fnName && ['api', 'writeJson', 'authFetch', 'fetch'].includes(fnName) && node.arguments.length) {
          const first = node.arguments[0];
          let routeText = null;
          if (ts.isStringLiteralLike(first)) routeText = first.text;
          else if (ts.isTemplateExpression(first)) {
            // Reconstruct with :p for every interpolation so it lines up with a controller path.
            let s = first.head.text;
            for (const sp of first.templateSpans) {
              const seg = sp.literal.text;
              s += /^[a-z]+$/.test(seg) ? `:p${seg}` : `:p${seg.startsWith('/') ? '' : '/'}${''}` + seg;
            }
            // Simpler: mark every interpolation as a whole segment placeholder.
            let out = first.head.text;
            for (const sp of first.templateSpans) out += '\u0000' + sp.literal.text;
            routeText = out;
          }
          if (routeText !== null) {
            // find method + body
            let method = null;
            let bodyKeys = null;
            let bodyIsWholeObject = false;
            for (const arg of node.arguments) {
              if (ts.isObjectLiteralExpression(arg)) {
                for (const prop of arg.properties) {
                  if (!ts.isPropertyAssignment(prop) || prop.name === undefined) continue;
                  const key = prop.name.getText(src).replace(/['"]/g, '');
                  if (key === 'method' && ts.isStringLiteralLike(prop.initializer)) method = prop.initializer.text.toUpperCase();
                  if (key === 'body') {
                    const init = prop.initializer;
                    // Resolve a bare identifier payload to the object literal behind it, e.g.
                    // JSON.stringify(payload) where payload is a const built a line above.
                    // SCOPE MATTERS: a file can declare the same name more than once (assets-fleet
                    // has two `const payload`, one per form). Resolving by first match in the file
                    // attributes the wrong body and invents findings that do not exist, so only a
                    // declaration ABOVE the call site counts.
                    // Unwrap: a form state initializer is usually useState({ … }) or a lazy
                    // useState(() => ({ … })), so the object literal is one or two calls deep.
                    const objectOf = (n) => {
                      if (!n) return null;
                      if (ts.isObjectLiteralExpression(n)) return n;
                      if (ts.isCallExpression(n)) {
                        const inner = n.arguments[0];
                        if (inner && ts.isObjectLiteralExpression(inner)) return inner;
                        // useState(() => ({ … })) — a thunk returning the object.
                        if (inner && ts.isArrowFunction(inner) && inner.body) return objectOf(inner.body);
                        if (inner && ts.isParenthesizedExpression(inner)) return objectOf(inner.expression);
                      }
                      return null;
                    };
                    let target = init;
                    if (init && ts.isCallExpression(init) && init.arguments[0] && ts.isIdentifier(init.arguments[0])) {
                      const name = init.arguments[0].text;
                      const callPos = node.getStart();
                      let found = null;
                      let best = -1;
                      const seek = (n2) => {
                        if (ts.isVariableDeclaration(n2) && n2.initializer) {
                          // Two declaration shapes reach this code:
                          //   const payload = { … }                       (identifier)
                          //   const [periodForm, setPeriodForm] = useState({…}) (array binding)
                          // The form-state case is the common one in this repo, and a check for
                          // isIdentifier alone silently skipped every one of them, leaving 13
                          // payloads unexamined and looking like a clean pass.
                          // const [periodForm, setPeriodForm] = useState({…}) produces a
                          // BindingElement, NOT an Identifier. Testing isIdentifier on the element
                          // is therefore always false, which is why 13 payloads silently stayed
                          // unexamined and the scan reported a clean pass. The form-state case is
                          // the common one in this repo, so this skipped most of them.
                          const bindingName = (el) => {
                            if (!el) return null;
                            if (ts.isIdentifier(el)) return el.text;
                            if (ts.isBindingElement(el) && el.name) return el.name.getText();
                            return null;
                          };
                          const matches =
                            (ts.isIdentifier(n2.name) && n2.name.text === name) ||
                            (ts.isArrayBindingPattern(n2.name) && n2.name.elements.some((el) => bindingName(el) === name));
                          if (matches) {
                            const pos = n2.getStart();
                            // Nearest declaration above the call wins.
                            if (pos < callPos && pos > best) { best = pos; found = n2.initializer; }
                          }
                        }
                        ts.forEachChild(n2, seek);
                      };
                      seek(src);
                      if (found) { target = found; resolvedFromState.add(name); }
                    }
                    const obj = objectOf(target) ?? objectOf(target && ts.isCallExpression(target) ? target.arguments[0] : null);
                    if (obj) {
                      const keys = [];
                      for (const bp of obj.properties) {
                        if (ts.isPropertyAssignment(bp) && bp.name) keys.push({ key: bp.name.getText(src).replace(/['"]/g, ''), spread: false });
                        else if (ts.isShorthandPropertyAssignment(bp)) keys.push({ key: bp.name.getText(src), spread: false });
                        else if (ts.isSpreadAssignment(bp)) { keys.push({ key: ' SPREAD', spread: true }); bodyIsWholeObject = true; }
                      }
                      bodyKeys = keys;
                    }
                  }
                }
              }
            }
            // writeJson(url, token, 'POST', body) — method is positional.
            if (!method && fnName === 'writeJson' && node.arguments.length >= 3) {
              const third = node.arguments[2];
              if (ts.isStringLiteralLike(third) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(third.text.toUpperCase())) {
                method = third.text.toUpperCase();
                const fourth = node.arguments[3];
                if (fourth && ts.isObjectLiteralExpression(fourth)) {
                  const keys = [];
                  for (const bp of fourth.properties) {
                    if (ts.isPropertyAssignment(bp) && bp.name) keys.push({ key: bp.name.getText(src).replace(/['"]/g, ''), spread: false });
                    else if (ts.isSpreadAssignment(bp)) { keys.push({ key: ' SPREAD', spread: true }); bodyIsWholeObject = true; }
                  }
                  bodyKeys = keys;
                }
              }
            }
            if (method && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
              sites.push({
                file: rel(file), line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                routeText, method, bodyKeys, bodyIsWholeObject, fnName,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
}

// ------------------------------------------------------------------ match
// A UI path is built as `${API}/assets/${id}/assign`. The API base is an interpolation too, so
// dropping NUL markers naively leaves a leading empty segment and the route never matches — which
// is why 86 sites looked unresolved. Rules, applied in order:
//   - "${API}" at the start is the base URL, not a path segment: drop it
//   - a segment that is a whole interpolation is a path parameter: collapse to :p
//   - a segment that merely CONTAINS an interpolation (e.g. an action name) keeps its literal text,
//     because that literal is what the route actually matches on
const normalise = (p) => {
  const segs = p
    .replace(/\?.*$/, '')
    .split('/')
    .filter((s) => s.length);
  const out = [];
  for (const s of segs) {
    // Segment is exactly one interpolation -> path parameter -> :p.
    // Segment contains an interpolation plus literal text (e.g. an action name) -> keep the
    // literal, because that literal is what the controller route matches on.
    // Segment is a bare ${API} -> the base URL, not a path segment at all -> drop it.
    if (/\u0000/.test(s)) {
      const stripped = s.replace(/\u0000/g, '');
      if (stripped.length === 0) {
        // Leading ${API} is the base URL; an interior one is a parameter.
        if (out.length > 0) out.push(':p');
        continue;
      }
      out.push(stripped);
    } else out.push(s);
  }
  return out.reduce((a, s) => a + '/' + s, '');
};

const routeIndex = new Map();
for (const r of routes) {
  const k = `${r.method} ${normalise(r.path)}`;
  if (!routeIndex.has(k)) routeIndex.set(k, []);
  routeIndex.get(k).push(r);
}

const findings = [];
const unresolved = [];
for (const s of sites) {
  const k = `${s.method} ${normalise(s.routeText)}`;
  const candidates = routeIndex.get(k);
  if (!candidates) { unresolved.push(s); continue; }
  for (const r of candidates) {
    if (!r.dto) continue;
    const dto = dtoMap.get(r.dto);
    if (!dto) { findings.push({ kind: 'DTO_NOT_FOUND', ...s, route: r }); continue; }
    if (!s.bodyKeys) { findings.push({ kind: 'BODY_NOT_LITERAL', ...s, route: r }); continue; }
    const allowed = propsOf(r.dto);
    const extra = s.bodyKeys.filter((b) => !b.spread && !allowed.has(b.key));
    if (extra.length) {
      findings.push({ kind: 'KEY_OUTSIDE_DTO', extraKeys: extra.map((b) => b.key), ...s, route: r, dto: r.dto });
    }
  }
}

// ------------------------------------------------------------------ report
// Thresholds are anti-vacuity, not tuning. Every one of these was crossed by a real parser defect
// in this repo, and each defect produced a CLEAN report rather than an error — which is the
// failure mode this file exists to make impossible.
const errors = [];
if (dtoMap.size < 180) errors.push(`dto parser under-parsed: ${dtoMap.size} classes`);
if (routes.length < 400) errors.push(`controller parser under-parsed: ${routes.length} routes`);
if (sites.length < 140) errors.push(`ui parser under-parsed: ${sites.length} mutation call sites`);
const boundDto = routes.filter((r) => r.dto).length;
if (boundDto < 150) errors.push(`dto binding under-parsed: ${boundDto} of ${routes.length} routes`);
if (heritage.size < 4) errors.push(`heritage resolution under-parsed: ${heritage.size} extends clauses`);

export const analysis = { dtoMap, routes, sites, findings, unresolved, boundDto, heritage, propsOf, normalise };
export const antiVacuityErrors = errors;
