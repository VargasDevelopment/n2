import { memo, type Ref } from 'react';
import Markdown, { type Components } from 'react-markdown';

const components: Components = {
  a: ({ children, className, node, ...props }) => {
    void node;
    return (
      <a
        {...props}
        className={[className, 'nodrag', 'nopan'].filter(Boolean).join(' ')}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  },
  // N² has no project-asset model yet. Rendering arbitrary image URLs would silently turn a
  // local Note into a network request, so preserve the intent without fetching the resource.
  img: ({ alt }) => (
    <span className="note-markdown__omitted-image" title="Image loading is disabled for Notes.">
      [Image omitted{alt ? `: ${alt}` : ''}]
    </span>
  )
};

// Memoised: an expanded Note's card re-renders with the canvas, and parsing is the costly part.
export const NoteMarkdown = memo(function NoteMarkdown({
  className,
  content,
  ref
}: {
  className: string;
  content: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={`note-markdown ${className}`}>
      <Markdown components={components}>{content}</Markdown>
    </div>
  );
});
