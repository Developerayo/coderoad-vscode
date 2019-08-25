import {join} from 'path'
import * as CR from 'typings'
import * as G from 'typings/graphql'
import * as vscode from 'vscode'
import ReactWebView from '../ReactWebView'
import {setStorage} from '../storage'
import {isEmptyWorkspace} from '../workspace'
import runTest from './runTest'

const COMMANDS = {
	START: 'coderoad.start',
	TUTORIAL_LAUNCH: 'coderoad.tutorial_launch',
	TUTORIAL_SETUP: 'coderoad.tutorial_setup',
	OPEN_WEBVIEW: 'coderoad.open_webview',
	SEND_STATE: 'coderoad.send_state',
	SEND_DATA: 'coderoad.send_data',
	RECEIVE_ACTION: 'coderoad.receive_action',
	OPEN_FILE: 'coderoad.open_file',
	RUN_TEST: 'coderoad.run_test',
	TEST_PASS: 'coderoad.test_pass',
	TEST_FAIL: 'coderoad.test_fail',
}

interface CreateCommandProps {
	vscodeExt: vscode.ExtensionContext
	machine: CR.StateMachine
	git: any
}

const resetLayout = () => {
	vscode.commands.executeCommand('vscode.setEditorLayout', {
		orientation: 0,
		groups: [{groups: [{}], size: 0.6}, {groups: [{}], size: 0.4}],
	})
}

export const createCommands = ({vscodeExt, machine, git}: CreateCommandProps) => {
	// React panel webview
	let webview: any

	return {
		// initialize
		[COMMANDS.START]: () => {

			let webviewState: 'INITIALIZING' | 'RESTARTING'
			if (!webview) {
				webviewState = 'INITIALIZING'
			} else if (webview.loaded) {
				// already loaded
				vscode.window.showInformationMessage('CodeRoad already open')
				return
			} else {
				webviewState = 'RESTARTING'
			}

			setStorage(vscodeExt.workspaceState)

			// activate machine
			webview = new ReactWebView(vscodeExt.extensionPath)
			if (webviewState === 'INITIALIZING') {
				machine.activate()
			} else if (webviewState === 'RESTARTING') {
				setTimeout(() => {
					// timeout hack to make data update on new windows
					// @ts-ignore
					machine.refresh()
				}, 1000)
			}
		},
		// open React webview
		[COMMANDS.OPEN_WEBVIEW]: (column: number = vscode.ViewColumn.Two) => {
			// setup 1x1 horizontal layout
			resetLayout()
			const callback = () => {
				machine.send('WEBVIEW_INITIALIZED')
			}
			webview.createOrShow(column, callback)
		},
		// launch a new tutorial
		// NOTE: may be better to move into action as logic is primarily non-vscode
		[COMMANDS.TUTORIAL_LAUNCH]: async (repo: G.TutorialRepo) => {
			console.log('launch tutorial')

			await isEmptyWorkspace()

			await git.gitInitIfNotExists()

			if (!repo || !repo.uri) {
				throw new Error('Tutorial repo uri not found')
			}

			await git.gitSetupRemote(repo.uri)

			machine.send('TUTORIAL_LOADED')
		},
		[COMMANDS.TUTORIAL_SETUP]: async (codingLanguage: G.EnumCodingLanguage) => {

			// TODO: allow multiple coding languages in a tutorial

			// setup onSave hook
			// console.log(`languageIds: ${languageIds.join(', ')}`)
			vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
				console.log('save document', document)
				if (document.uri.scheme === 'file' && codingLanguage === document.languageId) {
					// do work
					machine.send('TEST_RUN')
				}
			})
		},
		// open a file
		[COMMANDS.OPEN_FILE]: async (relativeFilePath: string) => {
			console.log(`OPEN_FILE ${JSON.stringify(relativeFilePath)}`)
			try {
				const workspaceRoot = vscode.workspace.rootPath
				if (!workspaceRoot) {
					throw new Error('No workspace root path')
				}
				const absoluteFilePath = join(workspaceRoot, relativeFilePath)
				const doc = await vscode.workspace.openTextDocument(absoluteFilePath)
				await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
				// there are times when intialization leave the panel behind any files opened
				// ensure the panel is redrawn on the right side first
				webview.createOrShow(vscode.ViewColumn.Two)
			} catch (error) {
				console.log(`Failed to open file ${relativeFilePath}`, error)
			}
		},
		// send messages to webview
		[COMMANDS.SEND_STATE]: (payload: {data: any; state: any}) => {
			webview.postMessage({type: 'SET_STATE', payload})
		},
		[COMMANDS.SEND_DATA]: (payload: {data: any}) => {
			webview.postMessage({type: 'SET_DATA', payload})
		},
		[COMMANDS.RECEIVE_ACTION]: (action: string | CR.Action) => {
			// send received actions from web-app into state machine
			machine.send(action)
		},
		[COMMANDS.RUN_TEST]: () => {
			runTest({
				onSuccess: () => machine.send('TEST_PASS'),
				onFail: () => machine.send('TEST_FAIL'),
			})
		},
		[COMMANDS.TEST_PASS]: () => {
			vscode.window.showInformationMessage('PASS')
		},
		[COMMANDS.TEST_FAIL]: () => {
			vscode.window.showWarningMessage('FAIL')
		},
	}
}
