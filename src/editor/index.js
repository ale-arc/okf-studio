// Módulo do editor (Milkdown) empacotado por esbuild como window.OKFEditor.
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core';
import {
  commonmark,
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand,
  wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, createCodeBlockCommand, insertHrCommand,
  insertImageCommand, toggleLinkCommand, turnIntoTextCommand
} from '@milkdown/preset-commonmark';
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/preset-gfm';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { clipboard } from '@milkdown/plugin-clipboard';
import { slashFactory, SlashProvider } from '@milkdown/plugin-slash';
import { callCommand, getMarkdown as getMd, replaceAll, insert } from '@milkdown/utils';
import { tableToolbar } from './table-toolbar.js';

const COMMANDS = {
  bold: [toggleStrongCommand], italic: [toggleEmphasisCommand], strike: [toggleStrikethroughCommand],
  codeInline: [toggleInlineCodeCommand], h1: [wrapInHeadingCommand, 1], h2: [wrapInHeadingCommand, 2],
  h3: [wrapInHeadingCommand, 3], bulletList: [wrapInBulletListCommand], orderedList: [wrapInOrderedListCommand],
  blockquote: [wrapInBlockquoteCommand], codeBlock: [createCodeBlockCommand], hr: [insertHrCommand],
  table: [insertTableCommand], undo: [undoCommand], redo: [redoCommand], clear: [turnIntoTextCommand]
};

let slashSeq = 0;

// Cria uma instância isolada do editor e retorna um handle com a API pública.
export async function createInstance(container, markdown, opts = {}) {
  const slash = slashFactory('okf-slash-' + (slashSeq++));
  let slashProvider = null;
  const SLASH_ITEMS = [
    { label: 'Título 1', run: () => run('h1') }, { label: 'Título 2', run: () => run('h2') },
    { label: 'Lista', run: () => run('bulletList') }, { label: 'Lista numerada', run: () => run('orderedList') },
    { label: 'Tarefas', run: () => taskList() }, { label: 'Citação', run: () => run('blockquote') },
    { label: 'Tabela', run: () => run('table') }, { label: 'Bloco de código', run: () => run('codeBlock') },
    { label: 'Linha horizontal', run: () => run('hr') }
  ];
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown || '');
      ctx.get(listenerCtx).markdownUpdated((_c, md) => { if (opts.onChange) opts.onChange(md); });
      ctx.set(slash.key, {
        view: (view) => {
          const content = document.createElement('div');
          content.className = 'okf-slash-menu';
          SLASH_ITEMS.forEach((it) => {
            const el = document.createElement('div');
            el.className = 'okf-slash-item';
            el.textContent = it.label;
            el.addEventListener('mousedown', (e) => {
              e.preventDefault();
              const { state, dispatch } = view;
              const { from } = state.selection;
              dispatch(state.tr.delete(from - 1, from));
              it.run();
              if (slashProvider) slashProvider.hide();
              focus();
            });
            content.appendChild(el);
          });
          slashProvider = new SlashProvider({ content });
          return {
            update: (uv, ps) => { slashProvider.update(uv, ps); },
            destroy: () => { slashProvider.destroy(); slashProvider = null; }
          };
        }
      });
    })
    .use(commonmark).use(gfm).use(history).use(listener).use(clipboard).use(slash).use(tableToolbar).create();

  function run(name) { if (COMMANDS[name]) { const [c, p] = COMMANDS[name]; editor.action(callCommand(c.key, p)); } }
  function taskList() { editor.action(insert('- [ ] ')); }
  function focus() { editor.action((ctx) => { ctx.get(editorViewCtx).focus(); }); }
  return {
    getMarkdown: () => editor.action(getMd()),
    setMarkdown: (md) => editor.action(replaceAll(md || '')),
    getView: () => editor.ctx.get(editorViewCtx),
    runCommand: run,
    taskList,
    link: (href) => { if (href) editor.action(callCommand(toggleLinkCommand.key, { href })); },
    image: (src) => { if (src) editor.action(callCommand(insertImageCommand.key, { src })); },
    insertConceptLink: (path, title) => {
      const p = path.startsWith('/') ? path : '/' + path;
      editor.action(insert('[' + (title || path) + '](' + p + ')', true));
    },
    focus,
    cursorEnd: () => editor.action((ctx) => {
      const view = ctx.get(editorViewCtx); const { doc } = view.state;
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(doc)));
      view.focus();
    }),
    destroy: async () => { await editor.destroy(); }
  };
}

// ---- Instância padrão (compatibilidade com window.OKFEditor.* já usado) ----
let def = null;
export async function create(container, markdown, opts = {}) { await destroy(); def = await createInstance(container, markdown, opts); return def; }
export function getMarkdown() { return def ? def.getMarkdown() : ''; }
export function getView() { return def ? def.getView() : null; }
export function setMarkdown(md) { if (def) def.setMarkdown(md); }
export function runCommand(name) { if (def) def.runCommand(name); }
export function taskList() { if (def) def.taskList(); }
export function link(href) { if (def) def.link(href); }
export function image(src) { if (def) def.image(src); }
export function insertConceptLink(path, title) { if (def) def.insertConceptLink(path, title); }
export function focus() { if (def) def.focus(); }
export function cursorEnd() { if (def) def.cursorEnd(); }
export function setTheme(theme) { void theme; }
export async function destroy() { if (def) { await def.destroy(); def = null; } }
