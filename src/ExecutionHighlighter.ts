import {
	Uri,
	window,
	TextEditor,
	Range,
	TextEditorDecorationType,
	workspace
} from "vscode";

export class ExecutionHighlighter {
	private readonly highlighter = new Highlighter();

	highlight(uri: Uri, line: number): void {
		if (!workspace.getConfiguration('realtime-debugging.highlight').get('enabled', true)) return;

		for (const editor of window.visibleTextEditors) {
			if (editor.document.uri.toString() !== uri.toString()) {
				continue;
			}
			const textLine = editor.document.lineAt(line);
			const firstChar = textLine.firstNonWhitespaceCharacterIndex;
			let range = textLine.range;
			if (firstChar !== range.end.character) range = range.with(range.start.with(undefined, firstChar));
			this.highlighter.highlight(editor, range);
		}
	}
}

export class Highlighter {
	private highlights: Highlight[] = [];

	highlight(editor: TextEditor, range: Range): void {
		const existingHighlight = this.highlights.find(highlight => highlight.isEqual(editor, range));
		if (existingHighlight) return existingHighlight.highlight(editor, range) && undefined;

		this.highlights = this.highlights.filter(highlight => highlight.active);
		const mostHighlights = workspace.getConfiguration('realtime-debugging.highlight').get('maximum', 10);
		if (this.highlights.length >= mostHighlights) this.highlights.splice(mostHighlights - 1).forEach(highlight => highlight.dispose());


		if (!existingHighlight) this.highlights.push(new Highlight().highlight(editor, range));
	}
}

class Highlight {
	private type: TextEditorDecorationType | undefined;
	private count: number = 0;
	private timeout!: NodeJS.Timeout;
	private editor!: TextEditor;
	private range!: Range;

	get active(){
		return this.type !== undefined;
	}

	isEqual(editor: TextEditor, range: Range){
		if (!this.range.isEqual(range)) return false;

		return this.editor.document.uri.toString() === editor.document.uri.toString();
	}

	highlight(textEditor: TextEditor, range: Range) {
		const colors = workspace.getConfiguration('realtime-debugging.highlight').get('colors', '#37afa9');
		if (this.type) {
			this.type.dispose();
			this.count++;
		}
		else{
			this.count = 0;
		}
		this.type = window.createTextEditorDecorationType({
			backgroundColor: colors[Math.min(this.count, colors.length - 1)],
		});
		textEditor.setDecorations(this.type, [range]);
		clearTimeout(this.timeout);
		this.timeout = setTimeout(() => {
			this.dispose();
		}, workspace.getConfiguration('realtime-debugging.highlight').get('fade', 1000));

		this.editor = textEditor;
		this.range = range;
		return this;
	}

	dispose() {
		if (this.type) {
			this.type.dispose();
		}
		this.type = undefined;
	}
}
