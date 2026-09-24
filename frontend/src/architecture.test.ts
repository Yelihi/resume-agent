import { expect, it } from "vitest";
import ts from "typescript";

const sources = import.meta.glob<string>([
  "./domain/**/*.ts", "./application/*.ts", "./features/**/*.tsx",
  "./views/*.ts", "./views/*.tsx", "./components/*.tsx", "./hooks/*.ts", "./viewer/*.tsx",
  "!**/*.test.*",
], { eager: true, query: "?raw", import: "default" });

it("keeps domain independent of UI, application, infrastructure and packages", () => {
  for (const [path, text] of Object.entries(sources).filter(([path]) => path.startsWith("./domain/"))) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const dependency = node.moduleSpecifier.text;
      expect(dependency, `${path}: ${dependency}`).toMatch(/^\./);
      expect(dependency, `${path}: ${dependency}`).not.toMatch(/infrastructure|application|features|components|viewer|hooks/);
    }
  }
});

it("keeps application and presentation free of infrastructure imports and transport calls", () => {
  for (const [path, text] of Object.entries(sources)) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node) {
      if (ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))) {
        expect(node.text, path).not.toMatch(/infrastructure|(?:^|\/)storage\//);
        expect(node.text, path).not.toBe("idb");
      }
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
        expect(node.expression.text, path).not.toMatch(/^(fetch|EventSource|XMLHttpRequest)$/);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
});
