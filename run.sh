mkdir -p ./proj_output

docker build -t proj-emscripten-builder .


docker run --rm \
    -v $(pwd)/proj_output:/usr/local/wasm \
    proj-emscripten-builder


docker build -t proj-emscripten-builder . && docker run --rm -v /home/jshaw/jjimenezshaw/PROJ:/build/proj_src -v $(pwd)/proj_output:/usr/local/wasm proj-emscripten-builder
rm -f proj_output/lib/libproj.a
docker build -t proj-emscripten-builder . && docker run --rm -v /home/jshaw/jjimenezshaw/PROJ:/build/proj_src -v $(pwd)/proj_output:/usr/local/wasm -v $(pwd)/proj_build_cache:/build proj-emscripten-builder
