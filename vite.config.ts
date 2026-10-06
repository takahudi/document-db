import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
	plugins: [react()], server: { host: '127.0.0.1' },
	build: { rolldownOptions: { output: { codeSplitting: { groups: [
		{ name: 'editor', test: /@tiptap|prosemirror/ },
		{ name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
		{ name: 'validation', test: /node_modules\/zod\// },
	] } } } },
})
