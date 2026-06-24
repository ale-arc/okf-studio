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

const slash = slashFactory('okf-slash');
let slashProvider = null;

const SLASH_ITEMS = [
  { label: 'Título 1', run: () => runCommand('h1') },
  { label: 'Título 2', run: () => runCommand('h2') },
  { label: 'Lista', run: () => runCommand('bulletList') },
  { label: 'Lista numerada', run: () => runCommand('orderedList') },
  { label: 'Tarefas', run: () => taskList() },
  { label: 'Citação', run: () => runCommand('blockquote') },
  { label: 'Tabela', run: () => runCommand('table') },
  { label: 'Bloco de código', run: () => runCommand('codeBlock') },
  { label: 'Linha horizontal', run: () => runCommand('hr') }
];

let editor = null;

export async function create(container, markdown, opts = {}) {
  await destroy();
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown || '');
      ctx.get(listenerCtx).markdownUpdated((_ctx, md) => { if (opts.onChange) opts.onChange(md); });
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
            update: (updatedView, prevState) => { slashProvider.update(updatedView, prevState); },
            destroy: () => { slashProvider.destroy(); slashProvider = null; }
          };
        }
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(slash)
    .create();
  return editor;
}

export function getMarkdown() {
  if (!editor) return '';
  return editor.action(getMd());
}

export function setMarkdown(md) {
  if (!editor) return;
  editor.action(replaceAll(md || ''));
}

const COMMANDS = {
  bold: [toggleStrongCommand],
  italic: [toggleEmphasisCommand],
  strike: [toggleStrikethroughCommand],
  codeInline: [toggleInlineCodeCommand],
  h1: [wrapInHeadingCommand, 1],
  h2: [wrapInHeadingCommand, 2],
  h3: [wrapInHeadingCommand, 3],
  bulletList: [wrapInBulletListCommand],
  orderedList: [wrapInOrderedListCommand],
  blockquote: [wrapInBlockquoteCommand],
  codeBlock: [createCodeBlockCommand],
  hr: [insertHrCommand],
  table: [insertTableCommand],
  undo: [undoCommand],
  redo: [redoCommand],
  clear: [turnIntoTextCommand]
};

export function runCommand(name) {
  if (!editor || !COMMANDS[name]) return;
  const [cmd, payload] = COMMANDS[name];
  editor.action(callCommand(cmd.key, payload));
}

export function taskList() {
  if (!editor) return;
  editor.action(insert('- [ ] '));
}

export function link(href) {
  if (!editor || !href) return;
  editor.action(callCommand(toggleLinkCommand.key, { href }));
}

export function image(src) {
  if (!editor || !src) return;
  editor.action(callCommand(insertImageCommand.key, { src }));
}

export function insertConceptLink(path, title) {
  if (!editor) return;
  const p = path.startsWith('/') ? path : '/' + path;
  editor.action(insert('[' + (title || path) + '](' + p + ')', true));
}

export function focus() {
  if (!editor) return;
  editor.action((ctx) => { ctx.get(editorViewCtx).focus(); });
}

export function cursorEnd() {
  if (!editor) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { doc } = view.state;
    view.dispatch(view.state.tr.setSelection(
      view.state.selection.constructor.atEnd(doc)
    ));
    view.focus();
  });
}

export function setTheme(theme) {
  // O editor herda as variáveis CSS do tema via [data-theme]; nada a fazer.
  void theme;
}

export async function destroy() {
  if (editor) { await editor.destroy(); editor = null; }
}
