'use strict';

function decodeXml(value) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function sourceNodes(source) {
  const nodes = [];
  for (const match of source.matchAll(/<([A-Za-z_][\w.$:-]*)(?:\s+([^<>]*?))?\s*\/?\s*>/g)) {
    const attributes = {};
    for (const attr of (match[2] || '').matchAll(/([:\w.-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[attr[1]] = decodeXml(attr[2] ?? attr[3]);
    }
    nodes.push({ tag: match[1], attributes });
  }
  return nodes;
}
function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part, i) => `${i ? `"'",` : ''}'${part}'`).join(',')})`;
}
async function resolveUnique(driver, selectors) {
  for (const selector of selectors) {
    const candidates = await driver.$$(selector);
    const visible = [];
    for (const candidate of candidates) {
      if (await candidate.isDisplayed()) visible.push(candidate);
    }
    if (visible.length === 1) return visible[0];
  }
  return undefined;
}
module.exports = { decodeXml, sourceNodes, xpathLiteral, resolveUnique };
