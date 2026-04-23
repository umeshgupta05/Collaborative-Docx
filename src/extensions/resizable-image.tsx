import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ImageNodeView from "@/components/ImageNodeView";

export interface ResizableImageOptions {
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableImage: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        width?: string | number;
        alignment?: string;
      }) => ReturnType;
    };
  }
}

const ResizableImage = Node.create<ResizableImageOptions>({
  name: "image",

  addOptions() {
    return {
      inline: false,
      allowBase64: true,
      HTMLAttributes: {},
    };
  },

  inline() {
    return this.options.inline;
  },

  group() {
    return this.options.inline ? "inline" : "block";
  },

  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      alignment: { default: "center" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          // Try to get alignment from parent figure or the img style
          let alignment = "center";
          const parent = element.parentElement;
          if (parent?.tagName === "FIGURE") {
            const style = parent.style.textAlign;
            if (style === "left" || style === "right" || style === "center") {
              alignment = style;
            }
          }
          return {
            src: element.getAttribute("src"),
            alt: element.getAttribute("alt"),
            title: element.getAttribute("title"),
            width: element.style.width || element.getAttribute("width") || null,
            alignment,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { alignment, width, ...attrs } = HTMLAttributes;
    const imgStyle = width ? `width: ${typeof width === "number" ? `${width}px` : width}` : "";
    return [
      "figure",
      {
        style: `text-align: ${alignment || "center"}; margin: 0.75rem 0;`,
        "data-type": "resizable-image",
      },
      [
        "img",
        mergeAttributes(this.options.HTMLAttributes, attrs, {
          style: imgStyle,
          draggable: "false",
        }),
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});

export default ResizableImage;
