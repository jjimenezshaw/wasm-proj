# wasm-proj
Welcome to Wasm PROJ. This is javascript library to use [PROJ](https://proj.org) compiled in webassembly.
It also has a set of pages using the library with some of the most used functionalites.

## TLDR;
To see it in action, just got to [https://jjimenezshaw.github.io/wasm-proj](https://jjimenezshaw.github.io/wasm-proj).
It contains some utilities that use the library:

### [CRS Transform](https://jjimenezshaw.github.io/wasm-proj/transform.html)
In CRS Transform you can perform coordinate tranformations from one CRS to another.
Very similar to [cs2cs](https://proj.org/apps/cs2cs.html).
There you can select a source and target CRS from a list, or introduce your own definition as PROJJSON, WKT, etc.
The input coordinates support several lines.
Most common field separators are supported.
Lines starting with a hash `#` are ignored.

At the bottom you can see the description (as text and as a proj pipeline) of the last transformation.

### [Pipeline Transform](https://jjimenezshaw.github.io/wasm-proj/transform_pipeline.html)
In case you have a defined transformation, you can use this page.
Very similar to [cct](https://proj.org/apps/cct.html).

### [projinfo](https://jjimenezshaw.github.io/wasm-proj/projinfo.html)
Run [projinfo](https://proj.org/apps/projinfo.html) directly in your browser.

## What is "Use network"?
This option (enabled by default in the webpage) will allow the code to access the needed gridfiles from [proj-data](https://cdn.proj.org/).
This is an internal functionality in PROJ native code.
When compiling with `emscripten` it tries to use `XMLHttpRequest` to download just one part from the grid.
That allows to run transformations that use grid files, like the geoid models.
Unfortunately it does not work in `node`.

There is a small limitation. The usage of this synchronous `XMLHttpRequest` has to be done in a `Web Worker`.
For that purpose the library includes code to run it asynchronously in the Web Worker.
No problem, the web page is doing that transparently for the user.
If you want to use it yourself, take it into account.

## Library wasm-proj
If you want to use the library on your own code, it is very easy to use.
This is a small library not trying to do complicated things.
It is not covering the whole functionality of PROJ. Just what I consider useful/needed so far.

The main purpose of the library is to hide the memory allocation - free needed
by the calls to [PROJ functions](https://proj.org/development/reference/functions.html).
It is done in a simple way, performing all that complexity inside each call.
The API tries to stay simple and clear.

The only exception (for now) is the `transformation`.
The construction of a transformation object is heavy compared with the coordinate transformation.
For that purpose a `Transformer` object has to be created.
Do not forget to call its method `dispose()` once you are done.

### Code
The code of the library is located in the folder [src](src).
The folder `wasm` is empty. To run properly it must contain the files `projModules.js` and `projModules.wasm`.
You can generate them with the `scripts` provided.
Or even better from PROJ GitHub Action [Emscripten](https://github.com/OSGeo/PROJ/actions/workflows/emscripten.yml).
Each build generates an artifact called `proj-js-wasm`.
Those artifacts are automatically deleted by GitHub after some time.
Maybe in the future they are included in the package of PROJ.

So far there is no packaging as npm. It may come in the future.

### Usage

This is not a complete documentation. Just the main things and a few examples.
Unfortunately you will have to go to the code to find more things there.

#### init()
The first thing to do is to init the library.
This loads the wasm module and some internal variables.

``` javascript
    const proj = new Proj();
    await proj.init();
```

(You can call `proj.dispose()` if you want to unload some things at the very end.
Do not use the object `proj` afterwards)

#### init() with grids support
If you want to perform transformations that need grid files, you must create the worker.
This is independent of the initialization done above. You can do both or just one.

``` javascript
    const bridge = new WorkerBridge();
    const proj_worker = bridge.create_main_proxy();
    await proj_worker.init();
```

Now you can call `proj_worker` the same way as `proj`. However those calls are all asynchronous.
You will need an `await` to get the expected result instead of the Promise.

In case you want to monitor the worker, call `await bridge.get_status()`.

(You can call `bridge.close()` once you are done. Specially to finish tests)

> **node**:
The library works in `node` too. Also the `WorkerBridge`.
However, as node does not implement `XMLHttpRequest`, the grid files will not be used.

#### Calling Proj class methods

With that object created and initialized you can call any method.
For instance, to get the version of PROJ, call

``` javascript
    const info = proj.proj_info();
    console.log(info)
```

and you will see something like
```
compilation_date: "2026-03-02T13:16:19+0000"
major: 9
minor: 8
patch: 0
release: "Rel. 9.8.0, March 2nd, 2026"
version: "9.8.0"
```

To do the same in the worker, just run
``` javascript
    const info = await proj_worker.proj_info();
    console.log(info)
```

#### projinfo()
This is like the `projinfo` command line.
``` js
const info = proj.projinfo({
    params:['EPSG:4326', '-o', 'WKT1_GDAL'],
    use_network:true
})
console.log(info)
```
It will return  `{rc: rc, msg: msg}` where `rc` is the return code (0 is Ok)
and `msg` the output information.

The need of `use_network` is just to indicate that to projinfo.
The output order for some transformations can be different (not in this example).

#### CRS list
The full list of CRSs in the database can be retrieved with
``` js
const crss = proj.crs_list() // all entries
const epsg = proj.crs_list({ auth_name: 'EPSG' }) // just from EPSG
```
The output can be large. More than 13,000 entries.

#### Transformations
Remember that to use grid files you have to run them in a web worker.
Using the `WorkerBridge` provided in the library you can just use the methods almost transparently.
In case you don't need grids, you can run them in the main thread, without needing the `await`.
``` javascript
const transformer = await proj_worker.create_transformer_from_crs({
    source_crs: "EPSG:4258",
    target_crs: "EPSG:25830+5782",
    use_network: true,
    promote_to_3D: true,
});

const points = [[40, 0, 0]]  // this is a vector of points
const transformed = await transformer.transform({ points: points });
await transformer.dispose();
console.log(transformed)
```
That will produce something like this (see how the elevation changed due to the geoid model used.)
```
[[756099.6479720162, 4432069.056784666, -50.28699472945679]]
```

#### Axes
``` javascript
const axes = proj.crs_axes({ crs: "EPSG:25830+5782" })
```
```
[
    {
        "name": "Easting",
        "abbr": "E",
        "direction": "east",
        "conv_factor": 1,
        "unit": "metre"
    },
    {
        "name": "Northing",
        "abbr": "N",
        "direction": "north",
        "conv_factor": 1,
        "unit": "metre"
    },
    {
        "name": "Gravity-related height",
        "abbr": "H",
        "direction": "up",
        "conv_factor": 1,
        "unit": "metre"
    }
]
```

### Documentation
There is no autogenerated documentation yet. Sorry about that.
But you can check the code in `projFunctions.js`.
There are more functions there than what you see in this readme.
Have fun!

## License
The license of this project is [MIT](LICENSE).
It uses the following libraries:
 - [PROJ](https://github.com/OSGeo/PROJ)
 - [libtiff](https://gitlab.com/libtiff/libtiff)
 - [sqlite3](https://www.sqlite.org/copyright.html)
 - [zlib](https://zlib.net/)
