/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import { isBuiltin } from 'node:module';
import * as path from 'path';
import * as ts from 'typescript';

function collectTypeScriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }
    return entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function getPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  if (
    !clause.name &&
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings)
  ) {
    return (
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((el) => el.isTypeOnly)
    );
  }
  return false;
}

describe('package.json dependencies', () => {
  it('declares all external runtime packages imported by src/', () => {
    const cliRoot = path.resolve(__dirname, '..');
    const packageJsonPath = path.join(cliRoot, 'package.json');
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8')
    ) as {
      dependencies?: Record<string, string>;
    };
    const declaredDependencies = new Set(
      Object.keys(packageJson.dependencies ?? {})
    );

    const srcDir = path.join(cliRoot, 'src');
    const missingByPackage = new Map<string, string[]>();

    for (const filePath of collectTypeScriptFiles(srcDir)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      for (const statement of sourceFile.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          if (isTypeOnlyImport(statement.importClause)) {
            continue;
          }
          const specifier = statement.moduleSpecifier.text;
          if (specifier.startsWith('.') || isBuiltin(specifier)) {
            continue;
          }
          const packageName = getPackageName(specifier);
          if (!declaredDependencies.has(packageName)) {
            const relFile = path.relative(cliRoot, filePath);
            const files = missingByPackage.get(packageName) ?? [];
            files.push(relFile);
            missingByPackage.set(packageName, files);
          }
        }
      }
    }

    expect(Object.fromEntries(missingByPackage)).toEqual({});
  });
});
