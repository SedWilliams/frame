/*
 * The toolbar floating at the bottom of the canvas, laid out like Figma's:
 * move tools, frame tools, shapes, drawing tools, text, comments, and Quick
 * actions. A grouped button shows the tool last used from its group, and its
 * caret lists the rest.
 */

import { useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Circle,
  Command,
  Frame,
  Hand,
  Image,
  LayoutTemplate,
  MessageCircle,
  Minus,
  MousePointer2,
  PenTool,
  Pencil,
  Scaling,
  Square,
  Star,
  Triangle,
  Type,
} from 'lucide-react';
import { set, useEditor, type Tool } from '../app/state';
import { commandById, displayKeys, runCommand } from '../app/commands';
import { Menu, type MenuItem } from './Menu';

interface ToolDef {
  tool: Tool | 'image';
  label: string;
  icon: ReactNode;
  command: string;
}

const groups: ToolDef[][] = [
  [
    { tool: 'move', label: 'Move', icon: <MousePointer2 size={17} />, command: 'tool-move' },
    { tool: 'hand', label: 'Hand tool', icon: <Hand size={17} />, command: 'tool-hand' },
    { tool: 'scale', label: 'Scale', icon: <Scaling size={17} />, command: 'tool-scale' },
  ],
  [
    { tool: 'frame', label: 'Frame', icon: <Frame size={17} />, command: 'tool-frame' },
    { tool: 'section', label: 'Section', icon: <LayoutTemplate size={17} />, command: 'tool-section' },
  ],
  [
    { tool: 'rectangle', label: 'Rectangle', icon: <Square size={16} />, command: 'tool-rectangle' },
    { tool: 'line', label: 'Line', icon: <Minus size={17} />, command: 'tool-line' },
    { tool: 'ellipse', label: 'Ellipse', icon: <Circle size={16} />, command: 'tool-ellipse' },
    { tool: 'polygon', label: 'Polygon', icon: <Triangle size={16} />, command: 'tool-polygon' },
    { tool: 'star', label: 'Star', icon: <Star size={16} />, command: 'tool-star' },
    { tool: 'image', label: 'Place image…', icon: <Image size={16} />, command: 'place-image' },
  ],
  [
    { tool: 'pen', label: 'Pen', icon: <PenTool size={16} />, command: 'tool-pen' },
    { tool: 'pencil', label: 'Pencil', icon: <Pencil size={16} />, command: 'tool-pencil' },
  ],
  [{ tool: 'text', label: 'Text', icon: <Type size={17} />, command: 'tool-text' }],
  [{ tool: 'comment', label: 'Comment', icon: <MessageCircle size={17} />, command: 'tool-comment' }],
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const [last, setLast] = useState<Record<number, number>>({});
  const [menu, setMenu] = useState<{ group: number; x: number; y: number } | null>(null);

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {groups.map((group, g) => {
        const activeIndex = group.findIndex((t) => t.tool === tool);
        const shown = group[activeIndex >= 0 ? activeIndex : (last[g] ?? 0)];
        const active = activeIndex >= 0;
        const keys = commandById.get(shown.command)?.keys?.[0];
        return (
          <div key={g} className={`tool-group${active ? ' active' : ''}`}>
            <button
              className="tool"
              aria-label={shown.label}
              aria-pressed={active}
              title={`${shown.label}${keys ? ` (${displayKeys(keys)})` : ''}`}
              onClick={() => runCommand(shown.command)}
            >
              {shown.icon}
            </button>
            {group.length > 1 && (
              <button
                className="tool-caret"
                aria-label={`More ${shown.label.toLowerCase()} tools`}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenu({ group: g, x: box.left - 30, y: box.top - 8 - (group.length * 30 + 12) });
                }}
              >
                <ChevronDown size={11} />
              </button>
            )}
          </div>
        );
      })}
      <span className="toolbar-divider" />
      <button className="tool actions" aria-label="Actions" title={`Actions (${displayKeys('Mod+K')})`} onClick={() => set({ palette: true })}>
        <Command size={16} />
        <span>Actions</span>
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={groups[menu.group].map(
            (t, i): MenuItem => ({
              kind: 'action',
              label: t.label,
              icon: t.icon,
              keys: commandById.get(t.command)?.keys?.[0],
              checked: t.tool === tool,
              run: () => {
                setLast((l) => ({ ...l, [menu.group]: i }));
                runCommand(t.command);
              },
            }),
          )}
        />
      )}
    </div>
  );
}
