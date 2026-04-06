import React, { memo } from "react";
import { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Highlighter,
  CheckSquare,
  Superscript,
  Subscript,
  Focus,
  Minus,
  Search,
  CaseSensitive,
  PanelLeft,
  Target,
  Maximize2,
  Palette,
  SquareDashedBottom,
  Download,
  BarChart3,
  History,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import TableInsert from "./TableInsert";
import LinkInsert from "./LinkInsert";

type DocumentBorderStyle = "none" | "thin" | "medium" | "thick" | "accent";

interface EditorToolbarProps {
  editor: Editor | null;
  isFocusMode: boolean;
  isZenMode: boolean;
  documentBorderStyle: DocumentBorderStyle;
  onToggleFocusMode: () => void;
  onToggleZenMode: () => void;
  onSetDocumentBorder: (style: DocumentBorderStyle) => void;
  onOpenFindReplace: () => void;
  onToggleOutline: () => void;
  onToggleWritingGoals: () => void;
  onToggleExport: () => void;
  onToggleWordFrequency: () => void;
  onToggleVersionHistory: () => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
}

const ToolbarButton = memo(
  ({
    icon,
    title,
    action,
    isActive,
    disabled,
    shortcut,
  }: {
    icon: React.ReactNode;
    title: string;
    action: () => void;
    isActive: boolean;
    disabled?: boolean;
    shortcut?: string;
  }) => (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={action}
            disabled={disabled}
            className={`h-8 w-8 p-0 rounded-md transition-colors ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="font-ui text-xs z-[100]">
          {title}
          {shortcut && (
            <span className="ml-1.5 text-muted-foreground">{shortcut}</span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
);

ToolbarButton.displayName = "ToolbarButton";

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  isFocusMode,
  isZenMode,
  documentBorderStyle,
  onToggleFocusMode,
  onToggleZenMode,
  onSetDocumentBorder,
  onOpenFindReplace,
  onToggleOutline,
  onToggleWritingGoals,
  onToggleExport,
  onToggleWordFrequency,
  onToggleVersionHistory,
  onInsertImage,
  onInsertVideo,
}) => {
  if (!editor) return null;

  const transformText = (type: "upper" | "lower" | "title" | "sentence") => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to);
    if (!text) return;
    let transformed: string;
    switch (type) {
      case "upper":
        transformed = text.toUpperCase();
        break;
      case "lower":
        transformed = text.toLowerCase();
        break;
      case "title":
        transformed = text.replace(
          /\w\S*/g,
          (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(),
        );
        break;
      case "sentence":
        transformed =
          text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
        break;
    }
    editor.chain().focus().insertContentAt({ from, to }, transformed).run();
  };

  const groups = [
    // Text formatting
    [
      {
        icon: <Bold className="h-3.5 w-3.5" />,
        title: "Bold",
        action: () => editor.chain().focus().toggleBold().run(),
        isActive: editor.isActive("bold"),
        shortcut: "⌘B",
      },
      {
        icon: <Italic className="h-3.5 w-3.5" />,
        title: "Italic",
        action: () => editor.chain().focus().toggleItalic().run(),
        isActive: editor.isActive("italic"),
        shortcut: "⌘I",
      },
      {
        icon: <Underline className="h-3.5 w-3.5" />,
        title: "Underline",
        action: () => editor.chain().focus().toggleUnderline().run(),
        isActive: editor.isActive("underline"),
        shortcut: "⌘U",
      },
      {
        icon: <Strikethrough className="h-3.5 w-3.5" />,
        title: "Strikethrough",
        action: () => editor.chain().focus().toggleStrike().run(),
        isActive: editor.isActive("strike"),
      },
      {
        icon: <Highlighter className="h-3.5 w-3.5" />,
        title: "Highlight",
        action: () => editor.chain().focus().toggleHighlight().run(),
        isActive: editor.isActive("highlight"),
      },
    ],
    // Headings
    [
      {
        icon: <Heading1 className="h-3.5 w-3.5" />,
        title: "Heading 1",
        action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: editor.isActive("heading", { level: 1 }),
      },
      {
        icon: <Heading2 className="h-3.5 w-3.5" />,
        title: "Heading 2",
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: editor.isActive("heading", { level: 2 }),
      },
      {
        icon: <Heading3 className="h-3.5 w-3.5" />,
        title: "Heading 3",
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: editor.isActive("heading", { level: 3 }),
      },
    ],
    // Blocks
    [
      {
        icon: <List className="h-3.5 w-3.5" />,
        title: "Bullet List",
        action: () => editor.chain().focus().toggleBulletList().run(),
        isActive: editor.isActive("bulletList"),
      },
      {
        icon: <ListOrdered className="h-3.5 w-3.5" />,
        title: "Ordered List",
        action: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: editor.isActive("orderedList"),
      },
      {
        icon: <CheckSquare className="h-3.5 w-3.5" />,
        title: "Task List",
        action: () => editor.chain().focus().toggleTaskList().run(),
        isActive: editor.isActive("taskList"),
      },
      {
        icon: <Quote className="h-3.5 w-3.5" />,
        title: "Quote",
        action: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: editor.isActive("blockquote"),
      },
      {
        icon: <Code className="h-3.5 w-3.5" />,
        title: "Code Block",
        action: () => editor.chain().focus().toggleCodeBlock().run(),
        isActive: editor.isActive("codeBlock"),
      },
      {
        icon: <Minus className="h-3.5 w-3.5" />,
        title: "Divider",
        action: () => editor.chain().focus().setHorizontalRule().run(),
        isActive: false,
      },
    ],
    // Alignment
    [
      {
        icon: <AlignLeft className="h-3.5 w-3.5" />,
        title: "Left",
        action: () => editor.chain().focus().setTextAlign("left").run(),
        isActive: editor.isActive({ textAlign: "left" }),
      },
      {
        icon: <AlignCenter className="h-3.5 w-3.5" />,
        title: "Center",
        action: () => editor.chain().focus().setTextAlign("center").run(),
        isActive: editor.isActive({ textAlign: "center" }),
      },
      {
        icon: <AlignRight className="h-3.5 w-3.5" />,
        title: "Right",
        action: () => editor.chain().focus().setTextAlign("right").run(),
        isActive: editor.isActive({ textAlign: "right" }),
      },
    ],
    // Super/Sub
    [
      {
        icon: <Superscript className="h-3.5 w-3.5" />,
        title: "Superscript",
        action: () => editor.chain().focus().toggleSuperscript().run(),
        isActive: editor.isActive("superscript"),
      },
      {
        icon: <Subscript className="h-3.5 w-3.5" />,
        title: "Subscript",
        action: () => editor.chain().focus().toggleSubscript().run(),
        isActive: editor.isActive("subscript"),
      },
    ],
    // History + Modes
    [
      {
        icon: <Undo className="h-3.5 w-3.5" />,
        title: "Undo",
        action: () => editor.chain().focus().undo().run(),
        isActive: false,
        disabled: !editor.can().undo(),
        shortcut: "⌘Z",
      },
      {
        icon: <Redo className="h-3.5 w-3.5" />,
        title: "Redo",
        action: () => editor.chain().focus().redo().run(),
        isActive: false,
        disabled: !editor.can().redo(),
        shortcut: "⌘⇧Z",
      },
      {
        icon: <Focus className="h-3.5 w-3.5" />,
        title: "Focus Mode",
        action: onToggleFocusMode,
        isActive: isFocusMode,
        shortcut: "⌘⇧F",
      },
      {
        icon: <Maximize2 className="h-3.5 w-3.5" />,
        title: "Zen Mode",
        action: onToggleZenMode,
        isActive: isZenMode,
      },
    ],
  ];

  const currentLineHeight =
    editor.getAttributes("paragraph")?.lineHeight || "default";

  const applyLineSpacingToDocument = (lineHeight: string | null) => {
    const { from, to } = editor.state.selection;
    const chain = editor.chain().focus().selectAll();

    if (lineHeight) {
      chain.setLineHeight(lineHeight).run();
    } else {
      chain.unsetLineHeight().run();
    }

    editor.chain().focus().setTextSelection({ from, to }).run();
  };

  const currentTextColor =
    editor.getAttributes("textStyle")?.color || "default";
  const colorPresets = [
    { label: "Default", value: "default", swatch: "transparent" },
    { label: "Slate", value: "#334155", swatch: "#334155" },
    { label: "Gray", value: "#4b5563", swatch: "#4b5563" },
    { label: "Blue", value: "#2563eb", swatch: "#2563eb" },
    { label: "Indigo", value: "#4338ca", swatch: "#4338ca" },
    { label: "Green", value: "#15803d", swatch: "#15803d" },
    { label: "Amber", value: "#b45309", swatch: "#b45309" },
    { label: "Red", value: "#b91c1c", swatch: "#b91c1c" },
  ] as const;

  const borderPresets = [
    { label: "None", value: "none" },
    { label: "Thin", value: "thin" },
    { label: "Medium", value: "medium" },
    { label: "Thick", value: "thick" },
    { label: "Accent Left", value: "accent" },
  ] as const;

  const applyTextColor = (value: string) => {
    if (value === "default") {
      editor.chain().focus().unsetColor().run();
      return;
    }
    editor.chain().focus().setColor(value).run();
  };

  return (
    <div className="border-b border-border/50 bg-card/80 backdrop-blur-sm px-2 sm:px-3 py-1.5 sticky top-0 z-10 overflow-x-auto">
      <div className="flex items-center gap-0.5 min-w-max">
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && (
              <Separator orientation="vertical" className="h-5 mx-1" />
            )}
            <div className="flex items-center gap-0.5">
              {group.map((item, ii) => (
                <ToolbarButton key={ii} {...item} isActive={!!item.isActive} />
              ))}
            </div>
          </React.Fragment>
        ))}

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Line spacing */}
        <DropdownMenu>
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-[10px] font-ui text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    LH{" "}
                    {currentLineHeight === "default"
                      ? "Auto"
                      : currentLineHeight}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-ui text-xs z-[100]">
                Line Spacing
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="start" className="font-ui text-xs">
            <DropdownMenuItem onClick={() => applyLineSpacingToDocument("1.2")}>
              Very Tight (1.2)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => applyLineSpacingToDocument("1.4")}>
              Tight (1.4)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => applyLineSpacingToDocument("1.6")}>
              Comfortable (1.6)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => applyLineSpacingToDocument("1.85")}
            >
              Relaxed (1.85)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => applyLineSpacingToDocument(null)}>
              Default
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Text color */}
        <DropdownMenu>
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Palette className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-ui text-xs z-[100]">
                Text Color
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="start" className="font-ui text-xs w-44">
            {colorPresets.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                onClick={() => applyTextColor(preset.value)}
                className="flex items-center justify-between"
              >
                <span>{preset.label}</span>
                <span
                  className="h-3 w-3 rounded-full border border-border"
                  style={{
                    backgroundColor:
                      preset.swatch === "transparent"
                        ? "hsl(var(--background))"
                        : preset.swatch,
                  }}
                />
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              disabled
              className="text-[10px] text-muted-foreground"
            >
              Active: {currentTextColor === "default" ? "Default" : "Custom"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Document border */}
        <DropdownMenu>
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-[10px] font-ui text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <SquareDashedBottom className="h-3.5 w-3.5 mr-1" />
                    BDR
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-ui text-xs z-[100]">
                Document Border
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="start" className="font-ui text-xs w-44">
            {borderPresets.map((preset) => (
              <DropdownMenuItem
                key={preset.value}
                onClick={() => onSetDocumentBorder(preset.value)}
                className="flex items-center justify-between"
              >
                <span>{preset.label}</span>
                {documentBorderStyle === preset.value && (
                  <span className="text-primary">Active</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Text Transform dropdown */}
        <DropdownMenu>
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <CaseSensitive className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-ui text-xs z-[100]">
                Text Transform
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="start" className="font-ui text-xs">
            <DropdownMenuItem onClick={() => transformText("upper")}>
              UPPERCASE
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => transformText("lower")}>
              lowercase
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => transformText("title")}>
              Title Case
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => transformText("sentence")}>
              Sentence case
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Quick actions */}
        <ToolbarButton
          icon={<Search className="h-3.5 w-3.5" />}
          title="Find & Replace"
          action={onOpenFindReplace}
          isActive={false}
          shortcut="⌘⇧H"
        />
        <ToolbarButton
          icon={<PanelLeft className="h-3.5 w-3.5" />}
          title="Document Outline"
          action={onToggleOutline}
          isActive={false}
        />
        <ToolbarButton
          icon={<Target className="h-3.5 w-3.5" />}
          title="Writing Goals"
          action={onToggleWritingGoals}
          isActive={false}
        />
        <LinkInsert editor={editor} />
        <TableInsert editor={editor} />
        <ToolbarButton
          icon={<ImageIcon className="h-3.5 w-3.5" />}
          title="Upload Image"
          action={onInsertImage}
          isActive={false}
        />
        <ToolbarButton
          icon={<Video className="h-3.5 w-3.5" />}
          title="Upload Video"
          action={onInsertVideo}
          isActive={false}
        />
        <ToolbarButton
          icon={<Download className="h-3.5 w-3.5" />}
          title="Export"
          action={onToggleExport}
          isActive={false}
        />
        <ToolbarButton
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          title="Word Frequency"
          action={onToggleWordFrequency}
          isActive={false}
        />
        <ToolbarButton
          icon={<History className="h-3.5 w-3.5" />}
          title="Version History"
          action={onToggleVersionHistory}
          isActive={false}
        />
      </div>
    </div>
  );
};

export default memo(EditorToolbar);
