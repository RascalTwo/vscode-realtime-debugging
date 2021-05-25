import { Disposable } from "@hediet/std/disposable";
import {
	Uri,
	window,
	workspace,
	MarkdownString,
	DecorationOptions,
	TextEditorDecorationType,
	commands
} from "vscode";

export class LogResultDecorator {
	public readonly dispose = Disposable.fn();

	private readonly map = new Map<
		string,
		{ uri: Uri; lines: Map<number, LineHistory> }
	>();
	private decorationType!: TextEditorDecorationType;

	updateDecorationType(){
		if (this.decorationType){
			this.clear();
			this.decorationType.dispose();
		}
		this.decorationType = this.dispose.track(
			window.createTextEditorDecorationType({
				after: {
					color: workspace.getConfiguration('realtime-debugging.line-history').get('color', 'gray'),
					margin: workspace.getConfiguration('editor').get('fontSize', 20) + 'px'
				},
			})
		);
	}

	constructor() {
		this.dispose.track(workspace.onDidChangeConfiguration(e => {
			if (!e.affectsConfiguration('realtime-debugging.line-history.color') && !e.affectsConfiguration('editor.fontSize')) return;

			this.updateDecorationType();
		}));
		this.updateDecorationType();
		this.dispose.track(
			workspace.onDidChangeTextDocument((evt) => {
				this.map.delete(evt.document.uri.toString());
				this.updateDecorations();
			})
		);
		this.dispose.track(commands.registerTextEditorCommand('realtime-debugging.clear-line-history', (editor, _, args: { line?: number }) => {
			const entry = this.map.get(editor.document.uri.toString());
			if (!entry) return this.clear();

			const firstLine = args?.line ?? editor.selection.start.line;
			const lastLine = args?.line ?? editor.selection.end.line;
			// If no lines are deleted from history, update decoration, otherwise clear everything
			return new Array(lastLine + 1 - firstLine)
					.fill(null)
					.map((_, i) => entry.lines.delete(firstLine + i))
					.some(Boolean)
						? this.updateDecorations()
						: this.clear();
		}));
	}

	public log(uri: Uri, line: number, output: string): void {
		if (!workspace.getConfiguration('realtime-debugging.line-history').get('enabled', true)) return;

		let entry = this.map.get(uri.toString());
		if (!entry) {
			entry = { uri, lines: new Map() };
			this.map.set(uri.toString(), entry);
		}

		let history = entry.lines.get(line);
		if (!history) {
			history = new LineHistory(uri, line);
			entry.lines.set(line, history);
		}

		history.history.unshift(output);

		this.updateDecorations();
	}

	public clear(): void {
		this.map.clear();
		this.updateDecorations();
	}

	private updateDecorations() {
		for (const editor of window.visibleTextEditors) {
			const entry = this.map.get(editor.document.uri.toString());
			if (!entry) {
				editor.setDecorations(this.decorationType, []);
				continue;
			}

			editor.setDecorations(
				this.decorationType,
				[...entry.lines.values()].map((history) => {
					const range = editor.document.lineAt(history.line).range;
					const hoverMessage = new MarkdownString();
					hoverMessage.isTrusted = true;
					hoverMessage.appendMarkdown('* ' + history.history.slice().reverse().join('\n* '));
					hoverMessage.appendMarkdown(`\n[Clear line](${Uri.parse(`command:realtime-debugging.clear-line-history?${JSON.stringify({ line: history.line })}`)})`);
					/*const params = encodeURIComponent(
						JSON.stringify({ stepId: o.id } as RunCmdIdArgs)
					);*/
					/*hoverMessage.appendMarkdown(
						`* [Run Step '${o.id}'](command:${runCmdId}?${params})`
					);*/

					return {
						range,
						renderOptions: {
							after: {
								contentText: history.history[0],
							},
						},
						hoverMessage,
					} as DecorationOptions;
				})
			);
		}
	}
}

class LineHistory {
	constructor(public readonly uri: Uri, public readonly line: number) {}
	public readonly history: string[] = [];
}
