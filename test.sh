#! /bin/sh

./build.sh
rm -Rf test/out
./bin/asseto bundle $PWD/test/source $PWD/test/out