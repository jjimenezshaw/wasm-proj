async function load_master(opts, url) {

    const response = await fetch(url);
    const html = await response.text();
    const fragment = document.createRange().createContextualFragment(html);
    const insert = fragment.getElementById('app-content')
    document.getElementById('app-content').replaceWith(insert);

    opts.wasm_dir = './wasm/'; // relative to the owner html.
    opts.wasm_worker_dir = '../master/wasm/'; // relative to projWorjer.js
    opts.map_relative_path = '..';
    const metadata = await load(opts);
    document.getElementById('version-data').innerHTML = `PROJ ${/.*(\(.*\)).*/.exec(metadata.release)[1]}
        compiled ${metadata.compilation_date}, EPSG: ${metadata['EPSG.VERSION']}`
}

//window.addEventListener('load', load_master);
