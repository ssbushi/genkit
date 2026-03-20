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

import { gemini15Flash, googleAI } from '@genkit-ai/googleai';
import * as fs from 'fs';
import { genkit, z } from 'genkit';
import { JSDOM } from 'jsdom';
import * as path from 'path';

const ai = genkit({
  plugins: [googleAI()],
  model: gemini15Flash,
});

const fetchUrl = ai.defineTool(
  {
    name: 'fetchUrl',
    description: 'Fetches the content of a URL and extracts its visible text.',
    inputSchema: z.object({
      url: z.string().describe('The URL to fetch.'),
    }),
    outputSchema: z.string(),
  },
  async ({ url }) => {
    try {
      console.log(`Fetching URL: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const dom = new JSDOM(html);

      const scripts = dom.window.document.querySelectorAll('script, style');
      scripts.forEach((node) => node.remove());

      let text = dom.window.document.body.textContent || '';
      text = text.replace(/\s+/g, ' ').trim();

      return text.substring(0, 100000);
    } catch (error: any) {
      console.error(`Error fetching URL: ${error.message}`);
      return `Failed to fetch URL: ${error.message}`;
    }
  }
);

const DeprecationSchema = z.object({
  deprecations: z
    .array(
      z.object({
        deprecatedModel: z
          .string()
          .describe(
            'The exact string identifier of the deprecated model (e.g., "gemini-1.0-pro-001" or "gemini-1.0-pro").'
          ),
        recommendedReplacement: z
          .string()
          .describe(
            'The exact string identifier of the recommended replacement model.'
          ),
      })
    )
    .describe('List of deprecated models and their recommended replacements.'),
});

const INITIAL_URLS = [
  'https://ai.google.dev/gemini-api/docs/deprecations',
  'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions',
];

async function getDeprecations() {
  console.log('Using Genkit to find deprecated models...');

  const response = await ai.generate({
    model: gemini15Flash,
    tools: [fetchUrl],
    prompt: `
      You are an expert AI developer tracking Google's Gemini model deprecations.
      Your task is to analyze the following documentation URLs and extract a comprehensive list of deprecated Gemini models and their recommended replacements.

      URLs to analyze:
      ${INITIAL_URLS.map((u) => `- ${u}`).join('\n')}

      Use the \`fetchUrl\` tool to fetch the content of these pages. Read through the text carefully.
      If you find links to other pages that might contain specific version deprecation details, you can use the \`fetchUrl\` tool to read those too.

      Once you have gathered the information, output a structured JSON response containing a list of objects, where each object has:
      - \`deprecatedModel\`: The exact string name of the deprecated model (e.g., "gemini-1.0-pro-001").
      - \`recommendedReplacement\`: The exact string name of the replacement model (e.g., "gemini-1.5-pro-001").

      Only include models that are explicitly marked as deprecated or have a scheduled shutdown date.
    `,
    output: { schema: DeprecationSchema },
  });

  return response.output?.deprecations || [];
}

function walkDir(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (['node_modules', 'dist', 'build', '.git', '.github'].includes(file))
        continue;
      fileList = walkDir(filePath, fileList);
    } else {
      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  try {
    const deprecations = await getDeprecations();
    console.log('\nFound the following deprecations:');
    console.log(JSON.stringify(deprecations, null, 2));

    if (deprecations.length === 0) {
      console.log('No deprecations found.');
      return;
    }

    const jsDir = path.resolve(__dirname, '../js');
    console.log(`\nScanning directory: ${jsDir}`);

    const filesToScan = walkDir(
      fs.existsSync(jsDir) ? jsDir : path.resolve(__dirname, '..')
    );
    let modifiedCount = 0;

    for (const file of filesToScan) {
      let content = fs.readFileSync(file, 'utf8');
      let originalContent = content;
      let modified = false;

      for (const { deprecatedModel, recommendedReplacement } of deprecations) {
        // Find exact string matches of the deprecated model surrounded by quotes
        const regex = new RegExp(`(['"\`])${deprecatedModel}(['"\`])`, 'g');
        if (regex.test(content)) {
          content = content.replace(regex, `$1${recommendedReplacement}$2`);
          modified = true;
          console.log(
            `Replaced '${deprecatedModel}' -> '${recommendedReplacement}' in ${file}`
          );
        }
      }

      if (modified && content !== originalContent) {
        fs.writeFileSync(file, content, 'utf8');
        modifiedCount++;
      }
    }

    console.log(`\nScan complete. Modified ${modifiedCount} files.`);
  } catch (err) {
    console.error('Error executing script:', err);
    process.exit(1);
  }
}

main();
