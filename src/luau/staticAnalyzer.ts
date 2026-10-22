/**
 * Luau Static Linter & Roblox API Deprecation Oracle
 * Analyzes scripts for deprecated APIs, performance anti-patterns, security/reliability flaws,
 * and standard code quality issues.
 */

export interface AnalysisIssue {
  type: 'deprecation' | 'performance' | 'security' | 'lint' | 'style';
  severity: 'error' | 'warning' | 'info';
  line: number;
  message: string;
  suggestion?: string;
  codeSnippet?: string;
}

export interface AnalysisReport {
  score: number; // 0-100
  passed: boolean;
  issues: AnalysisIssue[];
  deprecationsCount: number;
  warningsCount: number;
  errorsCount: number;
  summary: string;
}

export class LuauStaticAnalyzer {
  public static analyze(code: string): AnalysisReport {
    const issues: AnalysisIssue[] = [];
    const lines = code.split(/\r?\n/);

    const declaredLocals = new Map<string, number>();
    const referencedIdentifiers = new Set<string>();

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1];
      const trimmed = line.trim();

      // Skip empty or comment lines
      if (!trimmed || trimmed.startsWith("--")) continue;

      // 1. Deprecated Legacy Timing APIs
      if (/\bwait\s*\(/.test(line) && !/\btask\.wait\b/.test(line)) {
        issues.push({
          type: 'deprecation',
          severity: 'warning',
          line: lineNum,
          message: '`wait()` is deprecated. It runs on the legacy 30Hz pipeline and can throttle under load.',
          suggestion: 'Replace with `task.wait()` for deterministic 60Hz/frame-rate sync.',
          codeSnippet: trimmed
        });
      }

      if (/\bspawn\s*\(/.test(line) && !/\btask\.spawn\b/.test(line)) {
        issues.push({
          type: 'deprecation',
          severity: 'warning',
          line: lineNum,
          message: '`spawn()` is deprecated. It introduces an arbitrary delay (1-2 frames) before execution.',
          suggestion: 'Replace with `task.spawn()` for immediate execution without overhead.',
          codeSnippet: trimmed
        });
      }

      if (/\bdelay\s*\(/.test(line) && !/\btask\.delay\b/.test(line)) {
        issues.push({
          type: 'deprecation',
          severity: 'warning',
          line: lineNum,
          message: '`delay()` is deprecated.',
          suggestion: 'Replace with `task.delay(duration, fn)`.',
          codeSnippet: trimmed
        });
      }

      // 2. Deprecated Raycasting APIs
      if (/\bRay\.new\b/.test(line) || /\bFindPartOnRay\b/.test(line) || /\bfindPartOnRay\b/.test(line)) {
        issues.push({
          type: 'deprecation',
          severity: 'warning',
          line: lineNum,
          message: 'Legacy Ray.new() and FindPartOnRay() are deprecated.',
          suggestion: 'Use modern `workspace:Raycast(origin, direction, raycastParams)` with RaycastParams.',
          codeSnippet: trimmed
        });
      }

      // 3. Deprecated Legacy Physics BodyMovers
      if (/\bInstance\.new\s*\(\s*["'](BodyVelocity|BodyPosition|BodyGyro|BodyForce|BodyAngularVelocity|RocketPropulsion)["']\s*\)/.test(line)) {
        issues.push({
          type: 'deprecation',
          severity: 'warning',
          line: lineNum,
          message: 'BodyMover classes (BodyVelocity, BodyPosition, BodyGyro) are legacy and deprecated.',
          suggestion: 'Migrate to constraint movers: LinearVelocity, AlignPosition, AlignOrientation, or VectorForce.',
          codeSnippet: trimmed
        });
      }

      // 4. Performance: 2-argument Instance.new
      if (/\bInstance\.new\s*\(\s*["'][A-Za-z0-9]+["']\s*,\s*[^)]+\)/.test(line)) {
        issues.push({
          type: 'performance',
          severity: 'warning',
          line: lineNum,
          message: 'Using 2-argument `Instance.new(className, parent)` creates an unoptimized instance pipeline overhead.',
          suggestion: 'Construct the instance first, set properties (Size, Position, Anchored), and assign `.Parent` last.',
          codeSnippet: trimmed
        });
      }

      // 5. Direct game.Lighting property mutations
      if (/\bgame\.Lighting\./.test(line) && !/\bgame:GetService\(["']Lighting["']\)/.test(code)) {
        issues.push({
          type: 'style',
          severity: 'info',
          line: lineNum,
          message: 'Directly indexing `game.Lighting` without `game:GetService("Lighting")`.',
          suggestion: 'Use `local Lighting = game:GetService("Lighting")` to ensure safe service resolution.',
          codeSnippet: trimmed
        });
      }

      // 6. Security & Resilience: DataStore calls without pcall
      if (/\b(GetAsync|SetAsync|UpdateAsync|IncrementAsync|RemoveAsync)\s*\(/.test(line)) {
        // Check if line or preceding lines are inside a pcall
        let hasPcall = false;
        for (let check = Math.max(0, lineNum - 5); check < lineNum; check++) {
          if (lines[check].includes("pcall") || lines[check].includes("xpcall")) {
            hasPcall = true;
            break;
          }
        }
        if (!hasPcall) {
          issues.push({
            type: 'security',
            severity: 'error',
            line: lineNum,
            message: 'DataStore network I/O calls can throw runtime errors on network hiccups or rate limits.',
            suggestion: 'Always wrap DataStore calls inside `pcall(function() ... end)`.',
            codeSnippet: trimmed
          });
        }
      }

      // 7. Security & Resilience: HttpService calls without pcall
      if (/\bHttpService:(GetAsync|PostAsync|RequestAsync)\s*\(/.test(line)) {
        let hasPcall = false;
        for (let check = Math.max(0, lineNum - 5); check < lineNum; check++) {
          if (lines[check].includes("pcall") || lines[check].includes("xpcall")) {
            hasPcall = true;
            break;
          }
        }
        if (!hasPcall) {
          issues.push({
            type: 'security',
            severity: 'error',
            line: lineNum,
            message: 'HttpService calls can fail and throw if the remote endpoint drops or returns 4xx/5xx.',
            suggestion: 'Wrap external HTTP requests inside `pcall(function() ... end)`.',
            codeSnippet: trimmed
          });
        }
      }

      // 8. Infinite Loops without Yield
      if (/^while\s+true\s+do/.test(trimmed)) {
        // Look ahead 20 lines for task.wait, wait, or break
        let hasYield = false;
        for (let look = lineNum; look < Math.min(lines.length, lineNum + 20); look++) {
          if (/\b(task\.wait|wait|RunService|Heartbeat|RenderStepped|break)\b/.test(lines[look])) {
            hasYield = true;
            break;
          }
        }
        if (!hasYield) {
          issues.push({
            type: 'lint',
            severity: 'error',
            line: lineNum,
            message: 'Potential unyielding `while true do` loop detected. This will freeze the Luau execution thread.',
            suggestion: 'Add `task.wait()` or an exit condition inside the loop body.',
            codeSnippet: trimmed
          });
        }
      }

      // 9. Local variable tracking for shadowing
      const localMatch = trimmed.match(/^local\s+([A-Za-z0-9_]+)\s*=/);
      if (localMatch) {
        const varName = localMatch[1];
        if (declaredLocals.has(varName)) {
          issues.push({
            type: 'lint',
            severity: 'warning',
            line: lineNum,
            message: `Variable '${varName}' is shadowed. Previous declaration was on line ${declaredLocals.get(varName)}.`,
            suggestion: 'Rename the inner variable to avoid unintended shadowing bugs.',
            codeSnippet: trimmed
          });
        } else {
          declaredLocals.set(varName, lineNum);
        }
      }

      // Track references
      const words = line.match(/\b[A-Za-z0-9_]+\b/g) || [];
      for (const w of words) {
        referencedIdentifiers.add(w);
      }
    }

    // Unused local variables check
    for (const [varName, defLine] of declaredLocals.entries()) {
      // If it starts with _, ignore (convention for unused)
      if (varName.startsWith("_")) continue;
      let count = 0;
      for (const line of lines) {
        const regex = new RegExp(`\\b${varName}\\b`, 'g');
        const matches = line.match(regex);
        if (matches) count += matches.length;
      }
      if (count <= 1) { // only the declaration itself
        issues.push({
          type: 'lint',
          severity: 'info',
          line: defLine,
          message: `Variable '${varName}' is declared but never read.`,
          suggestion: 'Prefix with `_` or remove if redundant.',
          codeSnippet: lines[defLine - 1]?.trim()
        });
      }
    }

    const errorsCount = issues.filter(i => i.severity === 'error').length;
    const warningsCount = issues.filter(i => i.severity === 'warning').length;
    const deprecationsCount = issues.filter(i => i.type === 'deprecation').length;

    const penalty = errorsCount * 25 + warningsCount * 10 + deprecationsCount * 5;
    const score = Math.max(0, 100 - penalty);
    const passed = errorsCount === 0;

    const summary = passed
      ? `Analysis passed with quality score ${score}/100 (${warningsCount} warnings, ${deprecationsCount} deprecations).`
      : `Analysis failed with ${errorsCount} critical error(s) and quality score ${score}/100.`;

    return {
      score,
      passed,
      issues,
      deprecationsCount,
      warningsCount,
      errorsCount,
      summary
    };
  }
}
