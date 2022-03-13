# bitspace-mirroring-service
A Bitspace service with a RPC API for mirroring.

## Installation
```
npm i bitspace-mirroring-service
```

## Usage
This service is meant to run alongside a running Bitspace server.

With Bitspace running in a separate terminal:
```sh
❯ ./bin/index.js
Running bitspace-mirror/1.0.6 linux-x64 node-v14.15.0
Listening on /tmp/bitspace-mirroring.sock
```

Then you can import `bitspace-mirroring-service/client` inside a script, and it will auto-connect to the running server.

The mirror service provides an [HRPC](https://github.com/mafintosh/hrpc) endpoint with methods for mirroring, unmirror, and listing mirroed Unichain-based data structures.

Currently it supports mirroring Bitdrives and individual Unichains. It doesn't do data-structure detection by looking at Unichain headers -- you gotta explicitly provide the type.

As of now, Bitdrive mirroring doesn't handle mounts. Maybe one day

## API

#### `await client.mirror(key, type)`
Start mirroring a Unichain-based data structure.

This command will currently special-case the `bitdrive` type, mirroring both metadata and content feeds.

#### `await client.unmirror(key, type)`
Stop mirroring a Unichain-based data structure.

This command will currently special-case the `bitdrive` type, unmirroring both metadata and content feeds.

#### `await client.status(key, type)`
Check if a data structure is being mirrored;

Returns an object of the form:
```js
{
  key, // Buffer
  type, // string
  mirroring // bool
}
```

#### `await client.list()`
List all data structures being mirrored.

Returns an Array of status objects with the same shape as the `status` return value.

#### `await client.stop()`
Shut down the server.

## License
MIT
