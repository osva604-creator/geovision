import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import KMZ from '../js/kmz.js';

const options = { Parser: DOMParser, JSZip };
const kml = body => `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
const point = (name = 'Objetivo') => `<Placemark><name>${name}</name><Point><coordinates>-65.20,-26.83,120</coordinates></Point></Placemark>`;
async function file(entries, name = 'satellite.kmz') {
    const zip = new JSZip();
    for (const [path, data] of Object.entries(entries)) zip.file(path, data);
    return new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], name);
}

test('KMZ reads nested KMLs, names, coordinates in lon/lat order and duplicate identity', async () => {
    const input = await file({ 'doc.kml': kml(point()), 'layers/extra.kml': kml(point('Segundo')) });
    const result = await KMZ.readFile(input, options);
    assert.equal(result.features.length, 2);
    assert.deepEqual(result.features[0].geometry.coordinates, [-65.2, -26.83]);
    assert.equal(result.features[1].properties.name, 'Segundo');
    assert.equal(result.id, (await KMZ.readFile(input, options)).id);
    assert.notEqual(result.id, (await KMZ.readFile(await file({ 'doc.kml': kml(point('Otro')) }), options)).id);
});

test('namespace prefixes, polygons with holes, StyleMap, inline styles and attributes survive import', () => {
    const xml = kml(`<Style id="purple"><LineStyle><color>ffcc22aa</color><width>4</width></LineStyle><PolyStyle><color>80ff0000</color></PolyStyle></Style>
      <StyleMap id="map"><Pair><key>normal</key><styleUrl>#purple</styleUrl></Pair></StyleMap>
      <Folder><name>Detección</name><Placemark><name>Maleza</name><styleUrl>#map</styleUrl>
        <description><![CDATA[<b>Revisar campo</b>]]></description><ExtendedData><Data name="clase"><value>vegetación</value></Data></ExtendedData>
        <Style><LineStyle><width>3</width></LineStyle></Style>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,1 0,0</coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>0.4,0.4 0.6,0.4 0.6,0.6 0.4,0.6 0.4,0.4</coordinates></LinearRing></innerBoundaryIs></Polygon>
      </Placemark></Folder>`).replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g, '<$1k:$2').replace('xmlns=', 'xmlns:k=').replace('<k:b>', '<b>').replace('</k:b>', '</b>');
    const result = KMZ.parseKml(xml, options);
    assert.equal(result.features.length, 1);
    const { properties, geometry } = result.features[0];
    assert.equal(properties.folder, 'Detección');
    assert.equal(properties.description, 'Revisar campo');
    assert.deepEqual(properties.fields, [['clase', 'vegetación']]);
    assert.equal(properties.style.color, '#aa22cc');
    assert.equal(properties.style.fillColor, '#0000ff');
    assert.equal(properties.style.weight, 3);
    assert.equal(geometry.coordinates.length, 2);
    assert.equal(KMZ.distanceToGeometry([0.2, 0.2], geometry), 0);
    assert.ok(KMZ.distanceToGeometry([0.5, 0.5], geometry) > 10000, 'a hole must not be treated as identified area');
});

test('multigeometry keeps polygons and lines together without bridging separate shapes', () => {
    const result = KMZ.parseKml(kml(`<Placemark><MultiGeometry><Point><coordinates>0,0</coordinates></Point><LineString><coordinates>1,1 2,2</coordinates></LineString></MultiGeometry></Placemark>`), options);
    assert.equal(result.features[0].geometry.type, 'GeometryCollection');
    assert.equal(result.features[0].geometry.geometries.length, 2);
    assert.ok(KMZ.distanceToGeometry([1.5, 1.5], result.features[0].geometry) < 0.01);
    assert.ok(KMZ.distanceToGeometry([0.5, 0.5], result.features[0].geometry) > 70000);
});

test('bad coordinates, incomplete holes and unsupported antimeridian are reported without corrupting good features', () => {
    const result = KMZ.parseKml(kml(`${point()}<Placemark><Point><coordinates>999,NaN</coordinates></Point></Placemark>
      <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0,0</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
      <Placemark><LineString><coordinates>179,0 -179,1</coordinates></LineString></Placemark>`), options);
    assert.equal(result.features.length, 1);
    assert.equal(result.warnings.length, 3);
});

test('embedded PNG overlays use local assets; rotated, remote and missing images are reported', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII=', 'base64');
    const overlay = (href, rotation = 0) => `<GroundOverlay><name>Detección raster</name><Icon><href>${href}</href></Icon><LatLonBox><north>-26.8</north><south>-26.9</south><east>-65.1</east><west>-65.3</west><rotation>${rotation}</rotation></LatLonBox></GroundOverlay>`;
    const result = await KMZ.readFile(await file({ 'layers/doc.kml': kml(overlay('../image.png') + overlay('../image.png', 30) + overlay('https://example.com/private.png') + overlay('missing.png')), 'image.png': png }), options);
    assert.equal(result.overlays.length, 1);
    assert.equal(result.overlays[0].image.type, 'image/png');
    assert.deepEqual(result.overlays[0].bounds, [[-26.9, -65.3], [-26.8, -65.1]]);
    assert.equal(result.warnings.length, 3);
    assert.equal(KMZ.relativePath('doc.kml', '../../secret'), null);
    assert.equal(KMZ.relativePath('doc.kml', '%2f%2fevil.example/x'), null);
});

test('network links and descriptions do not execute or request remote content', async () => {
    const source = kml(`${point('&lt;script&gt;alert(1)&lt;/script&gt;')}<NetworkLink><Link><href>https://example.com/private.kml</href></Link></NetworkLink>`);
    const result = await KMZ.readFile(new File([source], 'safe.kml'), options);
    assert.equal(result.features[0].properties.name, '<script>alert(1)</script>');
    assert.equal(result.warnings.length, 1);
    assert.throws(() => KMZ.parseKml('<!DOCTYPE kml [<!ENTITY e SYSTEM "file:///private">]>' + source, options), /declaraciones XML/);
});

test('bad archives, invalid XML, empty content and oversized compressed or expanded data fail clearly', async () => {
    await assert.rejects(KMZ.readFile(new File(['bad'], 'bad.kmz'), options), /dañado/);
    await assert.rejects(KMZ.readFile(await file({ 'readme.txt': 'nothing' }), options), /ningún archivo KML/);
    await assert.rejects(KMZ.readFile(new File(['<kml><Placemark></kml>'], 'bad.kml'), options));
    await assert.rejects(KMZ.readFile(new File([kml('')], 'empty.kml'), options), /No se encontraron/);
    await assert.rejects(KMZ.readFile({ name: 'large.kmz', size: KMZ.LIMITS.file + 1 }, options), /25 MB/);
    await assert.rejects(KMZ.readFile(await file({ 'doc.kml': ' '.repeat(KMZ.LIMITS.kml + 1) }), options), /descomprimido/);
});

test('nearby-photo distances distinguish a field photo from a remote photo', () => {
    const geometry = { type: 'Point', coordinates: [-65.2, -26.83] };
    const nearby = KMZ.distanceToGeometry([-65.2, -26.8305], geometry);
    assert.ok(nearby > 50 && nearby < 60);
    assert.ok(KMZ.distanceToGeometry([-65.2, -26.85], geometry) > 2000);
});
