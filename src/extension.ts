import * as vscode from "vscode";
import {
	enableHotReload,
	hotRequireExportedFn,
	registerUpdateReconciler,
	getReloadCount,
} from "@hediet/node-reload";
import { Disposable } from "@hediet/std/disposable";

if (process.env.HOT_RELOAD) {
	enableHotReload({ entryModule: module, loggingEnabled: true });
}
registerUpdateReconciler(module);

import { ExecutionHighlighter } from "./ExecutionHighlighter";
import { LogResultDecorator } from "./LineHistory";

export class Extension {
	public readonly dispose = Disposable.fn();
	private readonly log: vscode.OutputChannel | undefined = this.dispose.track(
		vscode.window.createOutputChannel("debug log")
	);

	private readonly executionHightlighter = new ExecutionHighlighter();
	private readonly logResultDecorator = this.dispose.track(
		new LogResultDecorator()
	);

	constructor() {
		if (getReloadCount(module) > 0) {
			const i = this.dispose.track(vscode.window.createStatusBarItem());
			i.text = "reload" + getReloadCount(module);
			i.show();
		}

		const trackedLogpoints: {line: number, logMessage: string, path: string}[] = [];

		const variablesReferencesOutputting: {[variablesReference: number]: {line: number, path: string}} = {};
		const requestedVariables: {[seq: number]: {line: number, path: string}} = {};

		const outputTheThing = (path: string, line: number, output: string) => {
			const pathUri = vscode.Uri.file(path);

			this.executionHightlighter.highlight(pathUri, line);
			this.logResultDecorator.log(pathUri, line, output);
		}

		this.dispose.track(
			vscode.debug.registerDebugAdapterTrackerFactory("*", {
				createDebugAdapterTracker: (session) => ({
					onWillStartSession: () => {
						this.logResultDecorator.clear();
						if (this.log) {
							this.log.clear();
						}
					},
					onDidSendMessage: (message) => {
						if (message.command === 'variables' && message.type === 'response' && message.success){
							const request = requestedVariables[message.request_seq];
							if (request === undefined) return;
							// @ts-ignore
							outputTheThing(request.path, request.line - 1, message.body.variables.map(variable => variable.value).join('\n'));
						}
						if (
							message.event === "output" &&
							"body" in message &&
							message.body.category === "stdout"
						) {
							const body = message.body;
							const output = body.output;
							const source = body.source;
							if (!output && body.variablesReference){
								variablesReferencesOutputting[body.variablesReference] = { line: body.line, path: body.source.path };
								return;
							}

							if (!source.path) {
								const foundLogpoint = trackedLogpoints.find(point => {
									const { logMessage } = point;
									const regex = logMessage.replace(/{.*}/, '.*');
									return !!output.match(regex);
								});
								if (!foundLogpoint) return;
								Object.assign(source, { path: foundLogpoint.path });
								Object.assign(body, { line: foundLogpoint.line })
							}

							outputTheThing(source.path, body.line - 1, output);
						}

						if (this.log) {
							this.log.appendLine(
								"-> " + JSON.stringify(message)
							);
						}
					},
					onWillReceiveMessage: (message) => {
						if (this.log) {
							this.log.appendLine(
								"<- " + JSON.stringify(message)
							);
						}

						if (message.command === 'setBreakpoints') trackedLogpoints.push(...message.arguments.breakpoints
							// @ts-ignore
							.filter(breakpoint => 'logMessage' in breakpoint)
							// @ts-ignore
							.map(({ line, logMessage }) => ({ line, logMessage, path: message.arguments.source.path }))
						);

						if (message.command === 'variables' && message.type === 'request'){
							const variablesReference = variablesReferencesOutputting[message.arguments.variablesReference];
							if (variablesReference !== undefined) requestedVariables[message.seq] = variablesReference;
						}
					},
					onWillStopSession: () => {
						trackedLogpoints.length = 0;
					}
				}),
			})
		);
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		hotRequireExportedFn(module, Extension, (Extension) => new Extension())
	);
}

export function deactivate() {}
