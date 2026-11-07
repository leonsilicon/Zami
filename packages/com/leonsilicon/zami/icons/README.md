# @-/com.leonsilicon.zami.icons

The Zami app's `lucide-svelte`: Metro and TypeScript resolve that specifier to
`lucide-svelte.cjs` here, so translated components import icons exactly as upstream does.

```tsx
import { X } from "lucide-svelte";

<X size={16} className="text-discord-textMuted" />;
```

Each icon is lucide-react-native's, at the version Zam pins, wrapped by `withClassName`
so it also takes a `className`. Its `w-*`/`h-*` classes set the size unless `size` is
given, and its `text-*` color sets the stroke unless `color` is given. An icon on the web
inherits its parent's text color; in React Native nothing does, so give the icon the text
color class its parent has. Without one it falls back to Zam's primary text color.
