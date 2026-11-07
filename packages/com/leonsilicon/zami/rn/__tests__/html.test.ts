import { describe, expect, test } from "vite-plus/test";
import {
  flattenLayout,
  layoutHtml,
  parseHtml,
  readClassName,
  type HtmlLayout,
  type HtmlNode,
  type ParseOptions,
} from "#html-tree";

// Serializes parsed nodes back to HTML, so expectations read like sanitizeMatrixHtml's tests.
function html(nodes: HtmlNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text;
      const attrs = Object.entries(node.attrs)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join("");
      if (node.tag === "br" || node.tag === "img" || node.tag === "hr")
        return `<${node.tag}${attrs}>`;
      return `<${node.tag}${attrs}>${html(node.children)}</${node.tag}>`;
    })
    .join("");
}

function clean(input: string, options?: ParseOptions): string {
  return html(parseHtml(input, options));
}

// Laid-out HTML as `[run]` and `<block>` markers.
function layout(items: HtmlLayout[]): string {
  return items
    .map((item) =>
      item.type === "run"
        ? `[${html(item.children)}]`
        : `<${item.tag}>${layout(item.children)}</${item.tag}>`,
    )
    .join("");
}

function laidOut(input: string, preserveWhitespace = false): string {
  return layout(layoutHtml(parseHtml(input), { preserveWhitespace }));
}

describe("parseHtml keeps the Matrix spec's tags", () => {
  test("inline formatting", () => {
    const input =
      "<strong>bold</strong> <em>italic</em> <b>b</b> <i>i</i> <u>u</u> <s>s</s> <del>gone</del> " +
      "<code>x</code> <sup>1</sup><sub>2</sub> <span>sp</span> a<br>b";
    expect(clean(input)).toBe(input);
  });

  test("blocks", () => {
    const input =
      "<p>p</p><div>d</div><blockquote>q</blockquote><h1>1</h1><h6>6</h6><hr>" +
      "<ul><li>a</li></ul><ol><li>b</li></ol><pre><code>c</code></pre>" +
      "<table><caption>c</caption><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>" +
      "<details><summary>s</summary>more</details>";
    expect(clean(input)).toBe(input);
  });

  test("unwraps other elements and keeps their content", () => {
    expect(clean("<small>sub</small><marquee>x</marquee><form><b>y</b><input></form>")).toBe(
      "subx<b>y</b>",
    );
    expect(clean("<html><body><article>a</article></body></html>")).toBe("a");
  });

  test("lowercases tags and attributes", () => {
    expect(clean('<B>x</B><A HREF="https://e.com">y</A>')).toBe(
      '<b>x</b><a href="https://e.com">y</a>',
    );
  });
});

describe("parseHtml drops what sanitizeMatrixHtml drops", () => {
  test("scripts, styles, SVG, MathML, frames and media, with their content", () => {
    const out = clean(
      "a<script>alert(1)</script><style>body{background:url(x)}</style>" +
        "<svg onload=alert(1)><foreignObject><b>x</b></foreignObject></svg>" +
        "<math><mi>x</mi></math><iframe src=x>f</iframe><template>t</template>" +
        "<noscript>n</noscript><video>v</video><title>t</title>b",
    );
    expect(out).toBe("ab");
  });

  test("event handlers, inline styles and unknown attributes", () => {
    const out = clean(
      '<img src=x onerror="window.__xss=1"><a onclick=alert(1) style="position:fixed">x</a>' +
        '<span id="i" data-foo="1" aria-label="l" style="color:red">y</span>',
    );
    expect(out).toBe("<img><a>x</a><span>y</span>");
  });

  test("attributes that aren't legal on their tag", () => {
    expect(clean('<p data-mx-color="#ff0000" title="t">x</p>')).toBe("<p>x</p>");
    expect(clean('<a href="https://e.com" rel="opener" target="_blank" title="t">x</a>')).toBe(
      '<a href="https://e.com" target="_blank" title="t">x</a>',
    );
    expect(clean('<div data-mx-maths="x^2" data-mx-spoiler>m</div>')).toBe(
      '<div data-mx-maths="x^2">m</div>',
    );
  });

  test("javascript:, data:, vbscript:, relative and mxc: links", () => {
    for (const href of [
      "javascript:alert(1)",
      "  javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "/relative",
      "#fragment",
      "mxc://hs/abc",
      "file:///etc/passwd",
    ]) {
      expect(clean(`<a href="${href}">x</a>`)).toBe("<a>x</a>");
    }
  });

  test("keeps http(s), ftp, mailto, magnet and matrix links", () => {
    for (const href of [
      "https://example.com/?a=1&b=2",
      "http://e.com",
      "ftp://e.com",
      "mailto:a@b.c",
      "magnet:?xt=1",
      "matrix:r/room:hs",
    ]) {
      expect(parseHtml(`<a href=" ${href} ">x</a>`)).toEqual([
        { type: "element", tag: "a", attrs: { href }, children: [{ type: "text", text: "x" }] },
      ]);
    }
  });

  test("values that could break out of a comment or raw-text element", () => {
    expect(clean('<a href="https://e.com/--></style>">x</a>')).toBe("<a>x</a>");
  });

  test("classes, except code's language-* and Zam's own presentational ones", () => {
    expect(clean('<span class="fixed inset-0">x</span>')).toBe("<span>x</span>");
    expect(clean('<code class="language-js hljs">x</code>')).toBe(
      '<code class="language-js">x</code>',
    );
    expect(clean('<code class="notlang">x</code>')).toBe("<code>x</code>");
    expect(clean('<p class="room-mention">x</p>')).toBe("<p>x</p>");
    expect(
      clean('<span class="hljs-keyword evil">if</span> <span class="room-mention">@room</span>'),
    ).toBe('<span class="hljs-keyword">if</span> <span class="room-mention">@room</span>');
  });

  test("comments and CDATA", () => {
    expect(clean("a<!-- <b>x</b> -->b<![CDATA[c]]>")).toBe("ab");
  });
});

describe("mx-reply", () => {
  test("is removed with its content", () => {
    expect(
      clean(
        '<mx-reply><blockquote><a href="https://matrix.to/#/!r/$e">In reply to</a> quoted</blockquote></mx-reply>my answer',
      ),
    ).toBe("my answer");
  });

  test("wherever it is, whatever its attributes", () => {
    expect(clean('a<MX-REPLY data-x="1"><p>q</p></MX-REPLY>b')).toBe("ab");
  });
});

describe("images", () => {
  const resolveMxc = (mxc: string) =>
    mxc === "mxc://hs/gone" ? null : `https://hs/media/${mxc.slice(6)}`;

  test("resolves an mxc: source", () => {
    expect(
      clean('<img src="mxc://hs/abc" alt="pic" width="32" height="16" title="t">', { resolveMxc }),
    ).toBe('<img src="https://hs/media/hs/abc" alt="pic" width="32" height="16" title="t">');
  });

  test("drops an mxc: source the resolver can't resolve, or with no resolver", () => {
    expect(clean('<img src="mxc://hs/gone" alt="pic">', { resolveMxc })).toBe('<img alt="pic">');
    expect(clean('<img src="mxc://hs/abc" alt="pic">')).toBe('<img alt="pic">');
  });

  test("drops any other source (a tracking pixel, twemoji's local SVGs)", () => {
    expect(clean('<img src="https://evil.example/px.png" alt="x">', { resolveMxc })).toBe(
      '<img alt="x">',
    );
    expect(
      clean('<img src="/twemoji/svg/1f600.svg" alt="😀" class="twemoji" draggable="false" />', {
        resolveMxc,
      }),
    ).toBe('<img alt="😀">');
  });

  test("puts a picture on a line of its own, and leaves custom emoji inline", () => {
    const laid = (input: string) => layout(layoutHtml(parseHtml(input, { resolveMxc })));
    expect(laid('Two: <img src="mxc://hs/a" alt="a"> and <img src="mxc://hs/b" alt="b">')).toBe(
      "[Two:]<img></img>[and]<img></img>",
    );
    expect(laid('<p>hi <img data-mx-emoticon src="mxc://hs/e" alt=":e:"> there</p>')).toBe(
      '<p>[hi <img data-mx-emoticon="" src="https://hs/media/hs/e" alt=":e:"> there]</p>',
    );
    const [picture] = layoutHtml(parseHtml('<img src="mxc://hs/a" alt="a">', { resolveMxc }));
    expect(picture).toMatchObject({ type: "block", tag: "img", image: { tag: "img" } });
  });

  test("keeps custom emoji's data-mx-emoticon", () => {
    expect(
      clean('<img data-mx-emoticon src="mxc://hs/e" alt=":blob:" title=":blob:" height="32">', {
        resolveMxc,
      }),
    ).toBe(
      '<img data-mx-emoticon="" src="https://hs/media/hs/e" alt=":blob:" title=":blob:" height="32">',
    );
  });
});

describe("colors and spoilers", () => {
  test("keeps data-mx-color, data-mx-bg-color and font color", () => {
    expect(clean('<font color="#ff0000">r</font>')).toBe('<font color="#ff0000">r</font>');
    expect(clean('<font data-mx-color="#00FF00" data-mx-bg-color="#000">g</font>')).toBe(
      '<font data-mx-color="#00FF00" data-mx-bg-color="#000">g</font>',
    );
    expect(clean('<span data-mx-color="#123456" data-mx-bg-color="#abcdef">s</span>')).toBe(
      '<span data-mx-color="#123456" data-mx-bg-color="#abcdef">s</span>',
    );
  });

  test("takes font color's legacy names and bare hex", () => {
    expect(clean('<font color="Red">r</font><font color="00ff00">g</font>')).toBe(
      '<font color="red">r</font><font color="#00ff00">g</font>',
    );
  });

  test("drops colors React Native can't draw", () => {
    expect(
      clean(
        '<font color="url(x)">a</font><span data-mx-color="red">b</span><span data-mx-bg-color="#12345">c</span>',
      ),
    ).toBe("<font>a</font><span>b</span><span>c</span>");
  });

  test("keeps data-mx-spoiler and its reason", () => {
    expect(clean("<span data-mx-spoiler>secret</span>")).toBe(
      '<span data-mx-spoiler="">secret</span>',
    );
    expect(clean('<span data-mx-spoiler="plot">secret</span>')).toBe(
      '<span data-mx-spoiler="plot">secret</span>',
    );
  });

  test("ol start", () => {
    expect(clean('<ol start="3" reversed><li>c</li></ol>')).toBe('<ol start="3"><li>c</li></ol>');
  });
});

describe("entities", () => {
  test("are decoded in text, and escaped markup stays text", () => {
    expect(
      parseHtml("&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot; &#39;s&#39; &#x1F600; a&nbsp;b"),
    ).toEqual([{ type: "text", text: "<b>x</b> & \"q\" 's' 😀 a b" }]);
  });

  test("are decoded in attributes", () => {
    expect(parseHtml('<a href="https://e.com/?a=1&amp;b=2">x</a>')[0]).toMatchObject({
      attrs: { href: "https://e.com/?a=1&b=2" },
    });
  });

  test("a hostile attribute-breakout string stays inert", () => {
    expect(clean('"><img src=x onerror=alert(1)>')).toBe('"><img>');
  });
});

describe("layoutHtml", () => {
  test("inline content is one run", () => {
    expect(laidOut("a <b>b</b> <a href='https://e.com'>c</a><br>d")).toBe(
      '[a <b>b</b> <a href="https://e.com">c</a><br>d]',
    );
  });

  test("collapses whitespace and drops it between blocks", () => {
    expect(laidOut("\n<p>  a \n  <b> b </b>  c  </p>\n<ul>\n  <li> x </li>\n</ul>\n")).toBe(
      "<p>[a <b>b </b>c]</p><ul><li>[x]</li></ul>",
    );
  });

  test("removes spaces around line breaks", () => {
    expect(laidOut("a <br> b")).toBe("[a<br>b]");
  });

  test("a trailing <br> draws no empty line; a lone one is one line", () => {
    expect(laidOut("a<br>")).toBe("[a]");
    expect(laidOut("a<br><br>")).toBe("[a<br>]");
    expect(laidOut("<p><br></p>")).toBe("<p>[​]</p>");
  });

  test("runs between blocks", () => {
    expect(laidOut("a<blockquote>q</blockquote>b")).toBe("[a]<blockquote>[q]</blockquote>[b]");
  });

  test("splits an inline element around the blocks inside it", () => {
    expect(laidOut("x<span data-mx-spoiler>y<p>z</p>w</span>v")).toBe(
      '[x<span data-mx-spoiler="">y</span>]<p>[<span data-mx-spoiler="">z</span>]</p>[<span data-mx-spoiler="">w</span>v]',
    );
  });

  test("keeps whitespace in <pre>, minus its first and last newline", () => {
    expect(laidOut('<pre><code class="language-js">\nif (a)  {\n  b();\n}\n</code></pre>')).toBe(
      '<pre>[<code class="language-js">\nif (a)  {\n  b();\n}</code>]</pre>',
    );
    expect(laidOut("<pre>\nx\n</pre>")).toBe("<pre>[x]</pre>");
  });

  test("keeps whitespace when asked (room topics)", () => {
    expect(laidOut("line 1\n  line 2\n", true)).toBe("[line 1\n  line 2]");
  });

  test("drops what renders nothing", () => {
    expect(laidOut("  \n ")).toBe("");
    expect(laidOut("<p> </p><b></b>")).toBe("<p></p>");
  });

  test("leaves the parsed tree as it was", () => {
    const nodes = parseHtml("<pre>\nx\n</pre> a <br>");
    const before = JSON.stringify(nodes);
    layoutHtml(nodes);
    layoutHtml(nodes, { preserveWhitespace: true });
    expect(JSON.stringify(nodes)).toBe(before);
  });
});

describe("flattenLayout", () => {
  test("puts blocks on lines, with list markers", () => {
    const items = layoutHtml(
      parseHtml(
        '<p>intro</p><ol start="2"><li>two</li><li>three</li></ol><ul><li>dot</li></ul>' +
          "<pre><code>x</code></pre><details><summary>sum</summary>hidden</details>",
      ),
    );
    expect(html(flattenLayout(items))).toBe(
      "intro<br>2. two<br>3. three<br>• dot<br><code><code>x</code></code><br>sum",
    );
  });
});

describe("readClassName", () => {
  test("splits off link classes and layout flags", () => {
    expect(
      readClassName(
        "text-sm text-discord-textPrimary whitespace-pre-wrap break-words [&_a]:text-discord-accent [&_a]:underline emoji-only",
      ),
    ).toEqual({
      text: "text-sm text-discord-textPrimary break-words",
      link: "text-discord-accent underline",
      emojiOnly: true,
      preserveWhitespace: true,
    });
    expect(readClassName(undefined)).toEqual({
      text: "",
      link: "",
      emojiOnly: false,
      preserveWhitespace: false,
    });
  });
});
