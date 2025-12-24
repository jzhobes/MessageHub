import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Theme Variable Integrity', () => {
  const globalsPath = path.resolve(__dirname, '../../styles/globals.css');
  const cssContent = fs.readFileSync(globalsPath, 'utf-8');

  function extractVariables(selector: string, content: string): string[] {
    // This is a simplified parser for variables inside a specific selector block
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g');
    let variables: string[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const blockContent = match[1];
      const varRegex = /--[a-zA-Z0-9-]+(?=:)/g;
      const varMatches = blockContent.match(varRegex);
      if (varMatches) {
        variables = variables.concat(varMatches);
      }
    }
    return [...new Set(variables)];
  }

  it('ensures all variables in :root have a dark mode equivalent', () => {
    const rootVars = extractVariables(':root', cssContent).filter((v) => !v.startsWith('--radius-'));
    const darkVars = extractVariables("[data-theme='dark']", cssContent);

    // Filter out variables that are clearly not theme-dependent (like radii)
    // although in a perfect world, even radii could be themed.
    // For now, let's assume all of them should be defined.
    const missingInDark = rootVars.filter((v) => !darkVars.includes(v));

    expect(
      missingInDark,
      `Variables defined in :root but missing in [data-theme='dark']: ${missingInDark.join(', ')}`,
    ).toEqual([]);
  });

  it('ensures all variables in [data-theme="dark"] exist in :root', () => {
    const rootVars = extractVariables(':root', cssContent);
    const darkVars = extractVariables("[data-theme='dark']", cssContent);

    const missingInRoot = darkVars.filter((v) => !rootVars.includes(v));

    expect(
      missingInRoot,
      `Variables defined in [data-theme='dark'] but missing in :root: ${missingInRoot.join(', ')}`,
    ).toEqual([]);
  });
});
