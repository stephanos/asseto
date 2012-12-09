#! /bin/sh

rm -Rf lib/
mkdir lib/
cake build
cp -R src/vendor lib/vendor/