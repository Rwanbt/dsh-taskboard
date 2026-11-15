/**
 * README parity check — keeps the translated READMEs structurally identical.
 *
 * The three READMEs are hand-maintained translations of the same document:
 * `README.md` (Chinese, upstream), `README_en.md` (English) and `README_fr.md`
 * (French). A translation drifts silently: a section added on one side, a lost
 * table, a broken table of contents. This script compares the structure of two
 * files and fails when they diverge.
 *
 * It checks, inside code fences excluded:
 *  - the number of headings and their level sequence;
 *  - the number of fenced code blocks, tables, table lines, links, images,
 *    inline code spans, unordered and ordered list items, bold spans;
 *  - that every table-of-contents link (`- [Label](#anchor)`) resolves to a
 *    heading of the same file (GitHub anchor rules);
 *  - that the language switcher line links to the other two READMEs.
 *
 * Usage:
 *   node scripts/qa/readme-parity.mjs                       # en ↔ fr
 *   node scripts/qa/readme-parity.mjs README_en.md README.md
 *
 * Exits 0 when the two files are structurally identical, 1 otherwise.
 *
 * @module dsh-taskboard/scripts/qa/readme-parity
 */
import { readFileSync } from 'node:fs'

const FILES = ['README.md', 'README_en.md', 'README_fr.md']
const [base = 'README_en.md', other = 'README_fr.md'] = process.argv.slice(2)

/** GitHub heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
const slug = text => text
  .toLowerCase()
  .trim()
  .replace(/[^\p{L}\p{N}_\- ]/gu, '')
  .replace(/ +/g, '-')

/**
 * Read one README: headings, counts and the lines outside code fences.
 * @param {string} source - file content.
 */
function scan(source) {
  const lines = source.split('\n')
  const headings = []
  const body = []
  let fences = 0
  let open = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      fences += 1
      open = !open
      continue
    }
    if (open) continue
    body.push(line)
    if (/^#{1,6} /.test(line)) {
      headings.push({ level: line.match(/^#+/)[0].length, text: line.replace(/^#+ /, '') })
    }
  }
  const text = body.join('\n')
  const count = pattern => (text.match(pattern) ?? []).length
  return {
    lines,
    headings,
    levels: headings.map(heading => heading.level).join(''),
    codeBlocks: Math.floor(fences / 2),
    tables: count(/^\| *---/gm),
    tableLines: count(/^\|/gm),
    links: count(/\]\(/g),
    images: count(/<img /g),
    inlineCode: count(/`/g),
    unordered: count(/^\s*[-*] /gm),
    ordered: count(/^\s*\d+\. /gm),
    bold: count(/\*\*/g),
  }
}

/**
 * Resolve every table-of-contents link against the headings of the same file.
 * @param {ReturnType<typeof scan>} doc - scanned README.
 */
function tocReport(doc) {
  const anchors = new Set()
  const seen = new Map()
  for (const heading of doc.headings) {
    const base = slug(heading.text)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    anchors.add(n === 1 ? base : `${base}-${n - 1}`)
  }
  const entries = doc.lines.filter(line => /^- \[[^\]]+\]\(#/.test(line))
  return entries.map(line => {
    const label = line.match(/^- \[([^\]]+)\]/)[1]
    const anchor = line.match(/\(#([^)]+)\)/)[1]
    return { label, anchor, resolves: anchors.has(anchor) }
  })
}

/** The switcher line: the first line linking to the other READMEs. */
function switcherOf(doc) {
  return doc.lines.find(line => FILES.filter(file => line.includes(`(./${file})`)).length >= 2) ?? null
}

const baseDoc = scan(readFileSync(base, 'utf8'))
const otherDoc = scan(readFileSync(other, 'utf8'))

const KEYS = ['codeBlocks', 'tables', 'tableLines', 'links', 'images', 'inlineCode', 'unordered', 'ordered', 'bold']
const mismatches = []
const compare = (key, left, right) => { if (left !== right) mismatches.push(`${key}: ${base}=${left} ${other}=${right}`) }
compare('headings', baseDoc.headings.length, otherDoc.headings.length)
compare('heading levels', baseDoc.levels, otherDoc.levels)
for (const key of KEYS) compare(key, baseDoc[key], otherDoc[key])

const toc = tocReport(otherDoc)
const unresolved = toc.filter(entry => !entry.resolves).map(entry => `#${entry.anchor} (${entry.label})`)
const switcher = { base: switcherOf(baseDoc), other: switcherOf(otherDoc) }
const switcherOk = switcher.base !== null && switcher.other !== null
  && FILES.every(file => switcher.base.includes(`(./${file})`) || file === base)
  && FILES.every(file => switcher.other.includes(`(./${file})`) || file === other)

const verdict = {
  base,
  other,
  headings: { base: baseDoc.headings.length, other: otherDoc.headings.length },
  mismatches,
  toc: { entries: toc.length, unresolved },
  switcher,
  switcherOk,
  ok: mismatches.length === 0 && unresolved.length === 0 && switcherOk,
}

console.log(JSON.stringify(verdict, null, 2))
if (!verdict.ok) {
  console.error(`\nREADME parity FAILED between ${base} and ${other}`)
  process.exit(1)
}
console.error(`\nREADME parity OK: ${base} and ${other} are structurally identical (${baseDoc.headings.length} headings, ${baseDoc.codeBlocks} code blocks, ${toc.length} TOC entries)`)
