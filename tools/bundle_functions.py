#!/usr/bin/env python3
"""Build single-file copies of the server functions (supabase/functions/dist/*.ts)
for pasting into the Supabase dashboard editor. The GitHub Action deploys the
multi-file sources directly; use these only when deploying by hand."""
import re, pathlib
base = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "functions"
strip = lambda src: re.sub(r"^import .*?;\n", "", src, flags=re.M)
def unexport(s):
    for a in ("export class ", "export const ", "export async function ", "export type "):
        s = s.replace(a, a.replace("export ", ""))
    return s
http = strip((base / "_shared/http.ts").read_text())
conn = strip((base / "_shared/connectors.ts").read_text())
(base / "dist").mkdir(exist_ok=True)
for fn, shared in (("snapshot", conn + "\n" + http), ("sentinel", http)):
    src = (base / fn / "index.ts").read_text()
    lib = "\n".join(l for l in src.splitlines() if l.startswith("import ") and "supabase-js" in l)
    head = f"// GENERATED single-file build of supabase/functions/{fn}. Rebuild: python3 tools/bundle_functions.py\n"
    (base / "dist" / f"{fn}.ts").write_text(head + lib + "\n" + unexport(shared) + "\n" + strip(src))
    print("built", fn)
