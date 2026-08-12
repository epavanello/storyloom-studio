import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ingestBook } from '$lib/server/orchestrator';
import { listBooks } from '$lib/server/store';

export const load: PageServerLoad = async () => ({ books: await listBooks() });

export const actions: Actions = {
  upload: async ({ request }) => {
    const data = await request.formData();
    const file = data.get('book');
    if (!(file instanceof File) || file.size === 0) return fail(400, { message: 'Choose an EPUB, PDF or TXT file.' });
    if (file.size > 50 * 1024 * 1024) return fail(413, { message: 'The PoC accepts files up to 50 MB.' });
    let book;
    try {
      book = await ingestBook(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      return fail(400, { message: error instanceof Error ? error.message : 'The book could not be imported.' });
    }
    redirect(303, `/books/${book.id}`);
  },
  demo: async () => {
    const sample = `Capitolo I\n\nThe rain had polished every stone in Via delle Rose when Anna reached the old observatory. She stopped beneath the copper dome and unfolded the letter for the third time.\n\n“Midnight. Come alone,” it read.\n\nMarco was already waiting inside, a lantern in one hand and a brass key in the other. “You came,” he whispered, trying unsuccessfully to hide his relief.\n\nAnna closed the door behind her. The room smelled of dust, wet wool and something electric. Above them, the telescope began to turn by itself.\n\n“Tell me the truth,” Anna said. “What did my father find here?”\n\nMarco looked toward the dark aperture of the dome. “Not what. Who.”\n\nA pale blue light crossed the ceiling like the reflection of deep water. Somewhere inside the walls, an immense mechanism woke with a slow metallic breath.\n\nCapitolo II\n\nAt dawn the city was silent. Anna and Marco followed the map beneath the observatory, where narrow stairs descended farther than the hill should have allowed.\n\nAt the final landing they found a painted door and, beside it, the name Elena carved into the stone.`;
    const book = await ingestBook('The Observatory.txt', new TextEncoder().encode(sample));
    redirect(303, `/books/${book.id}`);
  }
};
