import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="mb-2 last:mb-0" {...props} />,
          strong: (props) => <strong className="font-semibold" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
          li: (props) => <li {...props} />,
          h1: (props) => <h1 className="text-base font-semibold mb-2 mt-3 first:mt-0" {...props} />,
          h2: (props) => <h2 className="text-sm font-semibold mb-2 mt-3 first:mt-0" {...props} />,
          h3: (props) => <h3 className="text-sm font-medium mb-1.5 mt-2 first:mt-0" {...props} />,
          code: ({ inline, className, children, ...props }: any) =>
            inline ? (
              <code
                className="rounded bg-brand-100/70 px-1 py-0.5 text-[12px] font-mono"
                {...props}
              >
                {children}
              </code>
            ) : (
              <pre className="rounded-lg bg-brand-900 text-white p-3 my-2 text-xs font-mono overflow-auto">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            ),
          a: (props) => (
            <a className="text-brand-accent underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
          ),
          blockquote: (props) => (
            <blockquote className="border-l-2 border-brand-200 pl-3 my-2 text-subink" {...props} />
          ),
          table: (props) => (
            <div className="overflow-auto my-2">
              <table className="min-w-full border-collapse text-xs" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-brand-50" {...props} />,
          th: (props) => (
            <th className="border border-line px-2 py-1 text-left font-medium" {...props} />
          ),
          td: (props) => <td className="border border-line px-2 py-1 tabular-nums" {...props} />,
          hr: () => <hr className="my-3 border-line" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
