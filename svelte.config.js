import adapter from "@sveltejs/adapter-node";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ out: "build" }),
  },
  vitePlugin: {
    inspector: {
      // this shortcut lets you open the selected component source in VSCode
      toggleKeyCombo: "meta-x",
      showToggleButton: "always",
      toggleButtonPos: "bottom-left",
    },
  },
};

export default config;
