import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import hljs from 'highlight.js/lib/common';
import { Check, Copy, Download, FileX } from 'lucide-react';
import { downloadFile, fileUrl } from '../api';
import { copyText } from '../lib/util';

// Normalise model output outside of code so remark-math (double-dollar only) can render it:
//   \[..\] and a line that is only $$..$$  -> display math
//   \(..\) and $..$                         -> inline math
// $..$ follows pandoc's rule (no space inside the delimiters, closing $ not followed by a digit),
// so prices like "$5 and $10" stay plain text. "([site.com](url))" citations become compact pills.
function prep(src) {
  return src
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
            .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, m) => `$$\n${m.trim()}\n$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$$${m.trim()}$$`)
            .replace(/(?<![\\$])\$(?![\s$])((?:[^$\n\\]|\\.)+?)(?<![\s\\])\$(?![\d$])/g, (_, m) => `$$${m}$$`)
            .replace(/\(\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)\)/g, (_, label, url) => ` [${label}](${url} "cite")`),
    )
    .join('');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function highlight(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang };
    if (code.length < 5000) {
      const r = hljs.highlightAuto(code);
      return { html: r.value, lang: lang || r.language || '' };
    }
  } catch {}
  return { html: escapeHtml(code), lang };
}

export const CodeBlock = memo(function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const out = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{out.lang || 'text'}</span>
        <button
          type="button"
          onClick={async () => {
            await copyText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: out.html }} />
      </pre>
    </div>
  );
});

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  return (node.children || []).map(textOf).join('');
}

function matchFile(files = [], href) {
  const name = decodeURIComponent(href.replace(/^sandbox:/, '').split('/').pop() || '');
  return files.find((f) => f.name === name || f.path === href.replace(/^sandbox:/, ''));
}

export function GenImage({ file, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file?.id) return;
    let alive = true;
    fileUrl(file.id, file.mime)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [file?.id]);
  if (!file?.id || failed) return <span className="gen-missing">{file?.name || 'Image'} (no longer available)</span>;
  return (
    <button type="button" className="gen-image" onClick={() => onOpen?.({ id: file.id, name: file.name, mime: file.mime })}>
      {src ? <img src={src} alt={file.name} /> : <span className="gen-image-loading" />}
    </button>
  );
}

function FileLink({ file, saving, children }) {
  if (!file && saving)
    return (
      <span className="file-link pending">
        <span className="mini-spin" />
        {children}
      </span>
    );
  if (!file || file.expired || !file.id)
    return (
      <span className="file-link expired" title="This file expired before it could be saved">
        <FileX size={14} />
        {children}
      </span>
    );
  return (
    <button type="button" className="file-link" onClick={() => downloadFile(file.id, file.name, file.mime)}>
      <Download size={14} />
      {children}
    </button>
  );
}

function Markdown({ text, files, saving, onOpenImage, className = '' }) {
  const components = useMemo(
    () => ({
      pre({ node }) {
        const code = node?.children?.[0];
        const cls = code?.properties?.className || [];
        const lang = cls.map(String).find((c) => c.startsWith('language-'))?.slice(9) || '';
        return <CodeBlock code={textOf(code).replace(/\n$/, '')} lang={lang} />;
      },
      a({ href = '', title, children }) {
        if (href.startsWith('sandbox:'))
          return (
            <FileLink file={matchFile(files, href)} saving={saving}>
              {children}
            </FileLink>
          );
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className={title === 'cite' ? 'cite' : undefined}>
            {children}
          </a>
        );
      },
      img({ src = '', alt }) {
        if (src.startsWith('sandbox:')) return <GenImage file={matchFile(files, src)} onOpen={onOpenImage} />;
        return <img src={src} alt={alt || ''} loading="lazy" />;
      },
      table({ children }) {
        return (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [files, saving, onOpenImage],
  );
  const src = useMemo(() => prep(text || ''), [text]);
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components}
        urlTransform={(url) => (url.startsWith('sandbox:') ? url : defaultUrlTransform(url))}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
