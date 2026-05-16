/**
 * SceneCodeViewer — read-only Monaco editor for displaying generated
 * Manim Python code. Lazy-imported by callers via React.lazy so Monaco
 * doesn't bloat the main bundle until the user actually opens a scene.
 */

import Editor from '@monaco-editor/react';

export function SceneCodeViewer({ code }: { code: string }) {
    // Height grows with line count up to a cap so short scenes don't waste
    // vertical space and long scenes don't take the whole viewport.
    const lineCount = code.split('\n').length;
    const height = Math.min(Math.max(lineCount * 18 + 16, 160), 520);

    return (
        <div className="rounded-lg overflow-hidden border border-white/10 bg-[#0a0a0a]">
            <Editor
                height={height}
                defaultLanguage="python"
                value={code}
                theme="vs-dark"
                options={{
                    readOnly: true,
                    domReadOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    renderLineHighlight: 'none',
                    folding: true,
                    automaticLayout: true,
                    padding: { top: 8, bottom: 8 },
                    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                }}
            />
        </div>
    );
}

export default SceneCodeViewer;
