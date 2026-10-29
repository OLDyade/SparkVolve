import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { parse } from 'parse5';
import GithubSlugger from 'github-slugger';

/** Parse links rather than matching prose, code fences or example commands. */
export function references(source, markdown) {
  const links = [],
    ids = new Set();
  const html = (text) => {
    const walk = (node) => {
      for (const attr of node.attrs ?? []) {
        if (attr.name === 'id' || (node.tagName === 'a' && attr.name === 'name')) ids.add(attr.value);
        if (['href', 'src', 'poster'].includes(attr.name)) links.push(attr.value);
      }
      for (const child of node.childNodes ?? []) walk(child);
    };
    walk(parse(text));
  };
  if (!markdown) html(source);
  else {
    const tree = unified().use(remarkParse).parse(source),
      slugger = new GithubSlugger();
    const definitions = new Map();
    visit(tree, 'definition', (node) => definitions.set(node.identifier, node.url));
    const text = (node) => node.value ?? node.children?.map(text).join('') ?? node.alt ?? '';
    visit(tree, (node) => {
      if (node.type === 'heading') ids.add(slugger.slug(text(node)));
      if (node.type === 'link' || node.type === 'image') links.push(node.url);
      if (node.type === 'linkReference' || node.type === 'imageReference') {
        assert.ok(definitions.has(node.identifier), `Undefined reference: ${node.identifier}`);
        links.push(definitions.get(node.identifier));
      }
      if (node.type === 'html') html(node.value);
    });
  }
  return { links, ids };
}

export async function checkLinks(root, files) {
  const published = new Set(files),
    parsed = new Map(),
    errors = [];
  const load = async (file) => {
    if (!parsed.has(file))
      parsed.set(file, references(await readFile(path.join(root, file), 'utf8'), file.endsWith('.md')));
    return parsed.get(file);
  };
  let count = 0;
  for (const file of files.filter((file) => /\.(md|html)$/.test(file))) {
    const { links } = await load(file);
    for (const link of links) {
      const url = new URL(link, `https://repository.invalid/${file}`);
      if (url.origin !== 'https://repository.invalid') continue;
      count++;
      const target = decodeURIComponent(url.pathname.slice(1)).replace(/\/$/, '');
      try {
        const info = await stat(path.join(root, target));
        if (info.isDirectory()) {
          assert.ok(
            target ? files.some((name) => name.startsWith(`${target}/`)) : files.length > 0,
            'directory is not published',
          );
        } else {
          assert.ok(published.has(target), 'file is not published');
          if (url.hash && /\.(md|html)$/.test(target)) {
            assert.ok(
              (await load(target)).ids.has(decodeURIComponent(url.hash.slice(1))),
              'anchor is missing',
            );
          }
        }
      } catch (error) {
        errors.push(`${file} -> ${link}: ${error.message}`);
      }
    }
  }
  assert.equal(errors.length, 0, `Broken local documentation links:\n${errors.join('\n')}`);
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean),
    ),
  ];
  // Site templates are validated after rendering into the deployment artifact.
  console.log(
    `Local documentation links passed: ${await checkLinks(
      root,
      files.filter((file) => !file.startsWith('site/')),
    )} references.`,
  );
}
