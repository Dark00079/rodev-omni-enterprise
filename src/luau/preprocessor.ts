/**
 * Luau to Lua 5.3 Preprocessor & Transpiler
 * Handles type annotations, compound assignments, string interpolation, continue, and if-expressions.
 */

export interface PreprocessResult {
  luaCode: string;
  originalCode: string;
  extractedTypes: Record<string, string>;
  warnings: string[];
}

export class LuauPreprocessor {
  /**
   * Transpile Luau code into standard Lua 5.3 compatible code.
   */
  public static transpile(source: string): PreprocessResult {
    const warnings: string[] = [];
    const extractedTypes: Record<string, string> = {};

    let code = source;

    // 1. Remove pragmas like --!strict, --!nocheck, --!nonstrict
    code = code.replace(/--!(strict|nocheck|nonstrict)/g, "-- pragma: $1");

    // 2. Extract and remove `export type X = ...` and `type X = ...`
    code = code.replace(/^(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/gm, (match, typeName, typeDef) => {
      extractedTypes[typeName] = typeDef.trim();
      return `-- type ${typeName} = ${typeDef}`;
    });

    // 3. String-aware transformation
    // We protect string literals and comments while applying transformations to code.
    const tokens: Array<{ type: 'string' | 'comment' | 'code'; text: string }> = [];
    let i = 0;
    let codeBuffer = "";

    const flushCode = () => {
      if (codeBuffer.length > 0) {
        tokens.push({ type: 'code', text: codeBuffer });
        codeBuffer = "";
      }
    };

    while (i < code.length) {
      // Check for multi-line comment: --[[ ... ]]
      if (code.startsWith("--[[", i)) {
        flushCode();
        const endIdx = code.indexOf("]]", i + 4);
        const comment = endIdx === -1 ? code.slice(i) : code.slice(i, endIdx + 2);
        tokens.push({ type: 'comment', text: comment });
        i += comment.length;
        continue;
      }

      // Check for single-line comment: -- ...
      if (code.startsWith("--", i)) {
        flushCode();
        let endIdx = code.indexOf("\n", i + 2);
        const comment = endIdx === -1 ? code.slice(i) : code.slice(i, endIdx);
        tokens.push({ type: 'comment', text: comment });
        i += comment.length;
        continue;
      }

      // Check for multi-line string: [[ ... ]]
      if (code.startsWith("[[", i)) {
        flushCode();
        const endIdx = code.indexOf("]]", i + 2);
        const str = endIdx === -1 ? code.slice(i) : code.slice(i, endIdx + 2);
        tokens.push({ type: 'string', text: str });
        i += str.length;
        continue;
      }

      // Check for double quote string
      if (code[i] === '"') {
        flushCode();
        let str = '"';
        i++;
        while (i < code.length) {
          if (code[i] === '\\' && i + 1 < code.length) {
            str += code[i] + code[i + 1];
            i += 2;
          } else if (code[i] === '"') {
            str += '"';
            i++;
            break;
          } else {
            str += code[i];
            i++;
          }
        }
        tokens.push({ type: 'string', text: str });
        continue;
      }

      // Check for single quote string
      if (code[i] === "'") {
        flushCode();
        let str = "'";
        i++;
        while (i < code.length) {
          if (code[i] === '\\' && i + 1 < code.length) {
            str += code[i] + code[i + 1];
            i += 2;
          } else if (code[i] === "'") {
            str += "'";
            i++;
            break;
          } else {
            str += code[i];
            i++;
          }
        }
        tokens.push({ type: 'string', text: str });
        continue;
      }

      // Check for backtick string interpolation: `text {expr} text`
      if (code[i] === '`') {
        flushCode();
        let raw = '`';
        i++;
        let inExpr = false;
        let exprDepth = 0;
        let pieces: string[] = [];
        let currentPiece = "";

        while (i < code.length) {
          if (!inExpr) {
            if (code[i] === '\\' && i + 1 < code.length) {
              currentPiece += code[i] + code[i + 1];
              i += 2;
            } else if (code[i] === '`') {
              i++;
              if (currentPiece.length > 0 || pieces.length === 0) {
                pieces.push(JSON.stringify(currentPiece));
              }
              break;
            } else if (code[i] === '{') {
              inExpr = true;
              exprDepth = 1;
              if (currentPiece.length > 0) {
                pieces.push(JSON.stringify(currentPiece));
                currentPiece = "";
              }
              i++;
            } else {
              currentPiece += code[i];
              i++;
            }
          } else {
            // inside { ... }
            if (code[i] === '{') {
              exprDepth++;
              currentPiece += '{';
              i++;
            } else if (code[i] === '}') {
              exprDepth--;
              if (exprDepth === 0) {
                inExpr = false;
                const innerExpr = currentPiece.trim();
                pieces.push(`tostring(${innerExpr})`);
                currentPiece = "";
                i++;
              } else {
                currentPiece += '}';
                i++;
              }
            } else {
              currentPiece += code[i];
              i++;
            }
          }
        }

        const interpolated = pieces.length > 0 ? `(${pieces.join(" .. ")})` : '""';
        tokens.push({ type: 'code', text: interpolated });
        continue;
      }

      // Regular character
      codeBuffer += code[i];
      i++;
    }
    flushCode();

    // Now process all code tokens
    let continueCounter = 0;

    for (const token of tokens) {
      if (token.type !== 'code') continue;

      let c = token.text;

      // 4. Strip Luau type casts: `expr :: type`
      c = c.replace(/::\s*[A-Za-z0-9_<>{},\s.:|?]+/g, "");

      // 5. Strip local variable type annotations: `local x: Type = ...` or `local x: Type`
      c = c.replace(/\blocal\s+([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_<>{},\s.:|?]+(?=\s*[,=;\n]|\s*$)/g, "local $1");

      // Strip function return type annotations: `): (Type)` or `): Type`
      c = c.replace(/\)\s*:\s*(?:\([^)]*\)|[A-Za-z0-9_<>{},\s.:|?]+)(?=\s*(?:\bdo\b|\bthen\b|\n|--|$))/g, ")");

      // Strip function parameter type annotations strictly inside `function ... (...)`
      c = c.replace(/\bfunction\s*([A-Za-z0-9_.:]*)\s*\(([^)]*)\)/g, (match, fnName, params) => {
        const cleanParams = params.split(",").map((p: string) => {
          const colonIdx = p.indexOf(":");
          return colonIdx !== -1 ? p.slice(0, colonIdx).trim() : p.trim();
        }).join(", ");
        return `function ${fnName}(${cleanParams})`;
      });

      // 6. Compound Assignment Operators
      // +=, -=, *=, /=, %=, ^=, ..=
      // E.g.: var += expr -> var = var + (expr)
      // E.g.: a.b[c] += expr
      c = c.replace(/([A-Za-z0-9_.\[\]'"\:]+)\s*(\+=|-=|\*=|\/=|%=|\^=|\.\.=)\s*([^;\n]+)/g, (match, lhs, op, rhs) => {
        const cleanLhs = lhs.trim();
        const cleanRhs = rhs.trim();
        const baseOp = op.slice(0, -1); // remove '='
        return `${cleanLhs} = ${cleanLhs} ${baseOp} (${cleanRhs})`;
      });

      // 7. If-then-else expressions (ternary in Luau):
      // if <cond> then <val1> else <val2> -> (function() if <cond> then return <val1> else return <val2> end end)()
      // We match `if .* then .* else .*` not at the beginning of a statement or inside an expression
      c = c.replace(/=\s*if\s+(.+?)\s+then\s+(.+?)\s+else\s+([^\n;]+)/g, (match, cond, val1, val2) => {
        return `= ((function() if ${cond} then return ${val1} else return ${val2} end end)())`;
      });

      token.text = c;
    }

    // 8. Luau `continue` keyword in loops
    // In Lua 5.3, replace `continue` with `goto __cont_${loopId}__` and place `::__cont_${loopId}__:` right before the loop's `end` or `until`.
    // Combine tokens with markers for strings/comments so keywords are matched safely.
    const markerPrefix = "\x01TOKEN_";
    const markerSuffix = "\x02";
    let combined = "";
    for (let idx = 0; idx < tokens.length; idx++) {
      if (tokens[idx].type === 'code') {
        combined += tokens[idx].text;
      } else {
        combined += `${markerPrefix}${idx}${markerSuffix}`;
      }
    }

    if (/\bcontinue\b/.test(combined)) {
      const kwRegex = /\b(for|while|repeat|do|if|function|end|until|continue)\b/g;
      interface LoopScope {
        id: number;
        type: 'loop' | 'repeat';
        needsLabel: boolean;
      }
      type StackFrame = LoopScope | { type: 'if' } | { type: 'func' } | { type: 'do' };

      const stack: StackFrame[] = [];
      let pendingLoop = 0;
      let loopCounter = 0;
      const replacements: Array<{ index: number; length: number; text: string }> = [];

      let m: RegExpExecArray | null;
      while ((m = kwRegex.exec(combined)) !== null) {
        const kw = m[1];
        const idx = m.index;

        if (kw === 'for' || kw === 'while') {
          pendingLoop++;
        } else if (kw === 'do') {
          if (pendingLoop > 0) {
            pendingLoop--;
            loopCounter++;
            stack.push({ type: 'loop', id: loopCounter, needsLabel: false });
          } else {
            stack.push({ type: 'do' });
          }
        } else if (kw === 'repeat') {
          loopCounter++;
          stack.push({ type: 'repeat', id: loopCounter, needsLabel: false });
        } else if (kw === 'if') {
          stack.push({ type: 'if' });
        } else if (kw === 'function') {
          stack.push({ type: 'func' });
        } else if (kw === 'continue') {
          let targetLoop: LoopScope | null = null;
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].type === 'func') break;
            if (stack[s].type === 'loop' || stack[s].type === 'repeat') {
              targetLoop = stack[s] as LoopScope;
              break;
            }
          }
          if (targetLoop) {
            targetLoop.needsLabel = true;
            replacements.push({ index: idx, length: 8, text: `goto __cont_${targetLoop.id}__` });
          }
        } else if (kw === 'end') {
          const top = stack.pop();
          if (top && top.type === 'loop' && top.needsLabel) {
            replacements.push({ index: idx, length: 0, text: `::__cont_${top.id}__::\n` });
          }
        } else if (kw === 'until') {
          if (stack.length > 0 && stack[stack.length - 1].type === 'repeat') {
            const top = stack.pop() as LoopScope;
            if (top.needsLabel) {
              replacements.push({ index: idx, length: 0, text: `::__cont_${top.id}__::\n` });
            }
          }
        }
      }

      replacements.sort((a, b) => b.index - a.index);
      for (const r of replacements) {
        combined = combined.slice(0, r.index) + r.text + combined.slice(r.index + r.length);
      }
    }

    const transpiled = combined.replace(/\x01TOKEN_(\d+)\x02/g, (_, idxStr) => {
      const idx = parseInt(idxStr, 10);
      return tokens[idx] ? tokens[idx].text : "";
    });

    return {
      luaCode: transpiled,
      originalCode: source,
      extractedTypes,
      warnings
    };
  }
}
