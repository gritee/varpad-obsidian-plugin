import { Notice, Plugin, setIcon, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import { isMap, isScalar, parseDocument, type YAMLMap } from 'yaml';

// Must match the number of .varpad-color-N classes in styles.css.
const VARIABLE_COLOR_COUNT = 8;

interface VarPadDocument {
  variables: Record<string, string>;
  snippets: Array<{ title: string; template: string }>;
}

interface OutputView {
  element: HTMLElement;
  template: string;
}

export default class VarPadPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor('varpad', (source, element, context) => {
      this.renderBlock(source, element, context);
    });
  }

  private renderBlock(source: string, element: HTMLElement, context: MarkdownPostProcessorContext): void {
    let document: VarPadDocument;
    try {
      document = parseVarPad(source);
    } catch (error) {
      element.empty();
      element.createDiv({
        cls: 'varpad-error',
        text: error instanceof Error ? error.message : 'Could not parse this VarPad block.',
      });
      return;
    }

    element.empty();
    const root = element.createDiv({ cls: 'varpad-block' });
    const values = { ...document.variables };
    const outputViews: OutputView[] = [];
    const colorIndexes = new Map(Object.keys(values).map((name, index) => [name, index % VARIABLE_COLOR_COUNT]));

    if (Object.keys(values).length > 0) {
      const variablesSection = root.createDiv({ cls: 'varpad-section' });
      variablesSection.createDiv({ cls: 'varpad-heading', text: 'Variables', attr: { role: 'heading', 'aria-level': '3' } });
      const variables = variablesSection.createDiv({ cls: 'varpad-variables' });

      for (const [name, initialValue] of Object.entries(values)) {
        const row = variables.createDiv({ cls: ['varpad-variable', `varpad-color-${colorIndexes.get(name)}`] });
        row.createSpan({ cls: 'varpad-variable-name', text: name });
        const input = row.createEl('input', {
          type: 'text',
          value: initialValue,
          attr: { 'aria-label': `Value for ${name}`, spellcheck: 'false' },
        });

        input.addEventListener('input', () => {
          values[name] = input.value;
          updateOutputs();
        });
        input.addEventListener('click', (event) => {
          if (event.detail >= 2) {
            window.requestAnimationFrame(() => input.select());
          }
        });
        input.addEventListener('change', () => {
          values[name] = input.value;
          void this.persistValues(context, element, values);
        });
      }
    }

    if (document.snippets.length > 0) {
      const snippetsSection = root.createDiv({ cls: 'varpad-section' });
      snippetsSection.createDiv({ cls: 'varpad-heading', text: 'Snippets', attr: { role: 'heading', 'aria-level': '3' } });
      const snippets = snippetsSection.createDiv({ cls: 'varpad-snippets' });

      for (const snippet of document.snippets) {
        const card = snippets.createDiv({ cls: 'varpad-snippet' });
        const header = card.createDiv({ cls: 'varpad-snippet-header' });
        header.createSpan({ cls: 'varpad-snippet-title', text: snippet.title });
        const status = header.createSpan({ cls: 'varpad-status', attr: { 'aria-live': 'polite' } });
        let statusTimer: number | undefined;
        status.addEventListener('transitionend', () => {
          if (!status.hasClass('is-visible')) status.setText('');
        });
        const copy = header.createEl('button', {
          cls: 'varpad-copy',
          attr: { type: 'button', 'aria-label': `Copy ${snippet.title}` },
        });
        setIcon(copy.createSpan({ cls: 'varpad-copy-icon' }), 'copy');
        copy.createSpan({ text: 'Copy' });
        const output = card.createEl('pre', { cls: 'varpad-output' });
        outputViews.push({ element: output, template: snippet.template });
        const showStatus = (message: string, isError: boolean): void => {
          status.setText(message);
          status.toggleClass('is-error', isError);
          status.addClass('is-visible');
          window.clearTimeout(statusTimer);
          statusTimer = window.setTimeout(() => status.removeClass('is-visible'), isError ? 3000 : 1000);
        };
        copy.addEventListener('click', () => {
          navigator.clipboard.writeText(output.textContent ?? '').then(
            () => showStatus('Copied', false),
            () => showStatus('Copy failed. Check clipboard permissions.', true),
          );
        });
      }
    }

    updateOutputs();

    function updateOutputs(): void {
      for (const view of outputViews) {
        renderTemplate(view.element, view.template, values, colorIndexes);
      }
    }
  }

  private async persistValues(
    context: MarkdownPostProcessorContext,
    element: HTMLElement,
    values: Record<string, string>,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    const section = context.getSectionInfo(element);
    if (!(file instanceof TFile) || !section) {
      new Notice('VarPad could not save values to this note.');
      return;
    }

    try {
      let foundBlock = false;
      await this.app.vault.process(file, (contents) => {
        const newline = contents.includes('\r\n') ? '\r\n' : '\n';
        const lines = contents.split(/\r?\n/);
        const sectionStart = Math.max(0, section.lineStart);
        const sectionEnd = Math.min(lines.length - 1, section.lineEnd + 1);
        const openingPattern = /^([ \t]*)(`{3,}|~{3,})\s*varpad(?:\s+[^\s]+)?\s*$/i;
        let openIndex = -1;
        let openMatch: RegExpMatchArray | null = null;

        for (let index = sectionStart; index <= sectionEnd; index += 1) {
          const match = lines[index]?.match(openingPattern);
          if (match) {
            openIndex = index;
            openMatch = match;
            break;
          }
        }
        if (openIndex < 0 || !openMatch) return contents;

        const indent = openMatch[1];
        const fence = openMatch[2];
        const closeIndex = lines.findIndex((line, index) =>
          index > openIndex && index <= sectionEnd && new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`).test(line),
        );
        if (closeIndex < 0) return contents;

        const blockSource = lines.slice(openIndex + 1, closeIndex).map((line) =>
          indent && line.startsWith(indent) ? line.slice(indent.length) : line,
        ).join('\n');
        const yaml = parseDocument(blockSource);
        if (yaml.errors.length > 0) throw yaml.errors[0];
        const variableMap = yaml.get('variables', true);
        if (!isMap(variableMap)) throw new Error('The variables field must be a YAML mapping.');

        for (const [name, value] of Object.entries(values)) {
          if (variableMap.has(name)) variableMap.set(name, value);
        }

        const replacement = yaml.toString().trimEnd().split('\n').map((line) => `${indent}${line}`);
        lines.splice(openIndex + 1, closeIndex - openIndex - 1, ...replacement);
        foundBlock = true;
        return lines.join(newline);
      });

      if (!foundBlock) new Notice('VarPad could not locate its source block to save values.');
    } catch (error) {
      new Notice(`VarPad could not save values: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}

function parseVarPad(source: string): VarPadDocument {
  const parsed = parseDocument(source);
  if (parsed.errors.length > 0) throw parsed.errors[0];
  const variablesNode = parsed.get('variables', true);
  const snippetsNode = parsed.get('snippets', true);
  if (!isMap(variablesNode)) throw new Error('Add a YAML mapping named “variables”.');
  if (!isMap(snippetsNode)) throw new Error('Add a YAML mapping named “snippets”.');

  return {
    variables: mapToStrings(variablesNode, 'Variable values'),
    snippets: Object.entries(mapToStrings(snippetsNode, 'Snippet templates')).map(([title, template]) => ({ title, template })),
  };
}

function mapToStrings(map: YAMLMap, label: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { key, value } of map.items) {
    if (!isScalar(key) || !isScalar(value)) {
      throw new Error(`${label} must use simple key-value pairs.`);
    }
    const name = key.value;
    const entry = value.value;
    if (typeof name !== 'string' || (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean')) {
      throw new Error(`${label} must contain scalar values.`);
    }
    result[name] = String(entry);
  }
  return result;
}

function renderTemplate(
  element: HTMLElement,
  template: string,
  values: Record<string, string>,
  colorIndexes: Map<string, number>,
): void {
  element.empty();
  const pattern = /\{\{([\w.-]+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    element.appendText(template.slice(lastIndex, match.index));
    const name = match[1];
    const value = values[name];
    if (value === undefined) {
      element.appendText(match[0]);
    } else {
      element.createSpan({ cls: ['varpad-value', `varpad-color-${colorIndexes.get(name)}`], text: value });
    }
    lastIndex = pattern.lastIndex;
  }
  element.appendText(template.slice(lastIndex));
}
