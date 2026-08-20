// The style vocabulary — the spine of Draught's taste model.
// Grouped the way the BJCP 2021 guidelines group them; each entry carries the
// style's name, family, country of origin and typical ABV band. Free text is
// always accepted when logging, but choosing from here is what makes styles
// comparable between drinkers.

export const FAMILIES = [
  'Pale Lager', 'Amber & Dark Lager', 'Bock', 'Pale Ale', 'IPA', 'Amber & Brown Ale',
  'Porter & Stout', 'Strong Ale', 'Wheat', 'Belgian', 'Sour & Wild', 'Smoke & Wood', 'Specialty',
];

// name, family, origin, abvLow, abvHigh
const RAW = [
  ['American Lager', 'Pale Lager', 'United States', 4.2, 5.3],
  ['German Pils', 'Pale Lager', 'Germany', 4.4, 5.2],
  ['Czech Premium Pale Lager', 'Pale Lager', 'Czechia', 4.2, 5.8],
  ['Czech Pale Lager', 'Pale Lager', 'Czechia', 3.0, 4.1],
  ['Munich Helles', 'Pale Lager', 'Germany', 4.7, 5.4],
  ['Festbier', 'Pale Lager', 'Germany', 5.8, 6.3],
  ['Dortmunder Export', 'Pale Lager', 'Germany', 4.8, 6.0],
  ['International Pale Lager', 'Pale Lager', 'International', 4.5, 6.0],
  ['Italian Pilsner', 'Pale Lager', 'Italy', 4.8, 5.6],
  ['Kellerbier', 'Pale Lager', 'Germany', 4.7, 5.6],

  ['Vienna Lager', 'Amber & Dark Lager', 'Austria', 4.7, 5.5],
  ['Märzen', 'Amber & Dark Lager', 'Germany', 5.6, 6.3],
  ['Altbier', 'Amber & Dark Lager', 'Germany', 4.3, 5.5],
  ['Munich Dunkel', 'Amber & Dark Lager', 'Germany', 4.5, 5.6],
  ['Schwarzbier', 'Amber & Dark Lager', 'Germany', 4.4, 5.4],
  ['Czech Amber Lager', 'Amber & Dark Lager', 'Czechia', 4.4, 5.8],
  ['Czech Dark Lager', 'Amber & Dark Lager', 'Czechia', 4.4, 5.8],
  ['Baltic Porter', 'Amber & Dark Lager', 'Poland', 6.5, 9.5],
  ['California Common', 'Amber & Dark Lager', 'United States', 4.5, 5.5],
  ['Rauchbier', 'Smoke & Wood', 'Germany', 4.8, 6.0],

  ['Helles Bock', 'Bock', 'Germany', 6.3, 7.4],
  ['Dunkles Bock', 'Bock', 'Germany', 6.3, 7.2],
  ['Doppelbock', 'Bock', 'Germany', 7.0, 10.0],
  ['Eisbock', 'Bock', 'Germany', 9.0, 14.0],
  ['Weizenbock', 'Wheat', 'Germany', 6.5, 9.0],

  ['American Pale Ale', 'Pale Ale', 'United States', 4.5, 6.2],
  ['Blonde Ale', 'Pale Ale', 'United States', 3.8, 5.5],
  ['Cream Ale', 'Pale Ale', 'United States', 4.2, 5.6],
  ['Kölsch', 'Pale Ale', 'Germany', 4.4, 5.2],
  ['British Golden Ale', 'Pale Ale', 'United Kingdom', 3.8, 5.0],
  ['Ordinary Bitter', 'Pale Ale', 'United Kingdom', 3.2, 3.8],
  ['Best Bitter', 'Pale Ale', 'United Kingdom', 3.8, 4.6],
  ['Strong Bitter', 'Pale Ale', 'United Kingdom', 4.6, 6.2],
  ['Australian Sparkling Ale', 'Pale Ale', 'Australia', 4.5, 6.0],
  ['Kentucky Common', 'Pale Ale', 'United States', 4.0, 5.5],

  ['American IPA', 'IPA', 'United States', 5.5, 7.5],
  ['Session IPA', 'IPA', 'United States', 3.5, 5.0],
  ['Double IPA', 'IPA', 'United States', 7.5, 10.0],
  ['Triple IPA', 'IPA', 'United States', 10.0, 13.0],
  ['Hazy IPA', 'IPA', 'United States', 6.0, 9.0],
  ['West Coast IPA', 'IPA', 'United States', 6.0, 7.5],
  ['English IPA', 'IPA', 'United Kingdom', 5.0, 7.5],
  ['Cold IPA', 'IPA', 'United States', 6.0, 7.5],
  ['Belgian IPA', 'IPA', 'Belgium', 6.2, 9.5],
  ['Black IPA', 'IPA', 'United States', 5.5, 9.0],
  ['Brut IPA', 'IPA', 'United States', 6.0, 7.5],
  ['Red IPA', 'IPA', 'United States', 5.5, 8.0],
  ['Rye IPA', 'IPA', 'United States', 5.5, 8.0],
  ['Milkshake IPA', 'IPA', 'United States', 6.0, 8.0],

  ['American Amber Ale', 'Amber & Brown Ale', 'United States', 4.5, 6.2],
  ['American Brown Ale', 'Amber & Brown Ale', 'United States', 4.3, 6.2],
  ['British Brown Ale', 'Amber & Brown Ale', 'United Kingdom', 4.2, 5.4],
  ['Dark Mild', 'Amber & Brown Ale', 'United Kingdom', 3.0, 3.8],
  ['Irish Red Ale', 'Amber & Brown Ale', 'Ireland', 3.8, 5.0],
  ['Scottish Light', 'Amber & Brown Ale', 'Scotland', 2.5, 3.2],
  ['Scottish Heavy', 'Amber & Brown Ale', 'Scotland', 3.2, 3.9],
  ['Scottish Export', 'Amber & Brown Ale', 'Scotland', 3.9, 6.0],

  ['English Porter', 'Porter & Stout', 'United Kingdom', 4.0, 5.4],
  ['American Porter', 'Porter & Stout', 'United States', 4.8, 6.5],
  ['Irish Stout', 'Porter & Stout', 'Ireland', 4.0, 4.5],
  ['Irish Extra Stout', 'Porter & Stout', 'Ireland', 5.5, 6.5],
  ['Sweet Stout', 'Porter & Stout', 'United Kingdom', 4.0, 6.0],
  ['Oatmeal Stout', 'Porter & Stout', 'United Kingdom', 4.2, 5.9],
  ['Tropical Stout', 'Porter & Stout', 'Caribbean', 5.5, 8.0],
  ['Foreign Extra Stout', 'Porter & Stout', 'United Kingdom', 6.3, 8.0],
  ['American Stout', 'Porter & Stout', 'United States', 5.0, 7.0],
  ['Imperial Stout', 'Porter & Stout', 'United Kingdom', 8.0, 12.0],
  ['Pastry Stout', 'Porter & Stout', 'United States', 8.0, 14.0],

  ['British Strong Ale', 'Strong Ale', 'United Kingdom', 5.5, 8.0],
  ['Old Ale', 'Strong Ale', 'United Kingdom', 5.5, 9.0],
  ['Wee Heavy', 'Strong Ale', 'Scotland', 6.5, 10.0],
  ['English Barleywine', 'Strong Ale', 'United Kingdom', 8.0, 12.0],
  ['American Barleywine', 'Strong Ale', 'United States', 10.0, 12.0],
  ['American Strong Ale', 'Strong Ale', 'United States', 6.3, 10.0],
  ['Double Red Ale', 'Strong Ale', 'United States', 7.0, 9.0],

  ['Weissbier', 'Wheat', 'Germany', 4.3, 5.6],
  ['Dunkles Weissbier', 'Wheat', 'Germany', 4.3, 5.6],
  ['American Wheat Beer', 'Wheat', 'United States', 4.0, 5.5],
  ['Witbier', 'Wheat', 'Belgium', 4.5, 5.5],
  ['Grisette', 'Wheat', 'Belgium', 3.0, 5.0],
  ['Roggenbier', 'Wheat', 'Germany', 4.5, 6.0],

  ['Belgian Single', 'Belgian', 'Belgium', 4.8, 6.0],
  ['Belgian Dubbel', 'Belgian', 'Belgium', 6.0, 7.6],
  ['Belgian Tripel', 'Belgian', 'Belgium', 7.5, 9.5],
  ['Belgian Quadrupel', 'Belgian', 'Belgium', 9.0, 12.0],
  ['Belgian Blond Ale', 'Belgian', 'Belgium', 6.0, 7.5],
  ['Belgian Pale Ale', 'Belgian', 'Belgium', 4.8, 5.5],
  ['Belgian Golden Strong Ale', 'Belgian', 'Belgium', 7.5, 10.5],
  ['Belgian Dark Strong Ale', 'Belgian', 'Belgium', 8.0, 12.0],
  ['Saison', 'Belgian', 'Belgium', 3.5, 9.5],
  ['Bière de Garde', 'Belgian', 'France', 6.0, 8.5],
  ['Trappist Ale', 'Belgian', 'Belgium', 5.0, 11.0],

  ['Berliner Weisse', 'Sour & Wild', 'Germany', 2.8, 3.8],
  ['Gose', 'Sour & Wild', 'Germany', 4.2, 5.0],
  ['Lambic', 'Sour & Wild', 'Belgium', 5.0, 6.5],
  ['Gueuze', 'Sour & Wild', 'Belgium', 5.0, 8.0],
  ['Fruit Lambic', 'Sour & Wild', 'Belgium', 5.0, 7.0],
  ['Flanders Red Ale', 'Sour & Wild', 'Belgium', 4.6, 6.5],
  ['Oud Bruin', 'Sour & Wild', 'Belgium', 4.0, 8.0],
  ['American Wild Ale', 'Sour & Wild', 'United States', 4.0, 9.0],
  ['Kettle Sour', 'Sour & Wild', 'United States', 4.0, 6.0],
  ['Sour IPA', 'Sour & Wild', 'United States', 5.0, 7.5],

  ['Classic Style Smoked Beer', 'Smoke & Wood', 'Germany', 4.0, 8.0],
  ['Piwo Grodziskie', 'Smoke & Wood', 'Poland', 2.5, 3.7],
  ['Lichtenhainer', 'Smoke & Wood', 'Germany', 3.5, 4.7],
  ['Barrel-Aged Beer', 'Smoke & Wood', 'International', 6.0, 15.0],

  ['Fruit Beer', 'Specialty', 'International', 4.0, 8.0],
  ['Spiced Beer', 'Specialty', 'International', 4.0, 9.0],
  ['Winter Seasonal Beer', 'Specialty', 'International', 5.0, 9.0],
  ['Coffee Beer', 'Specialty', 'International', 4.5, 12.0],
  ['Chocolate Beer', 'Specialty', 'International', 5.0, 12.0],
  ['Alternative Grain Beer', 'Specialty', 'International', 4.0, 9.0],
  ['Gluten-Free Beer', 'Specialty', 'International', 4.0, 7.0],
  ['Non-Alcoholic Beer', 'Specialty', 'International', 0.0, 0.5],
  ['Table Beer', 'Specialty', 'Belgium', 1.0, 3.5],
  ['Hard Seltzer', 'Specialty', 'United States', 4.0, 6.0],
  ['Experimental Beer', 'Specialty', 'International', 3.0, 15.0],
];

export const STYLES = RAW.map(([name, family, origin, abvLow, abvHigh]) => ({
  name, family, origin, abvLow, abvHigh,
}));

export const STYLE_NAMES = STYLES.map((s) => s.name);
export const BY_NAME = new Map(STYLES.map((s) => [s.name.toLowerCase(), s]));

export const findStyle = (name) => BY_NAME.get(String(name || '').toLowerCase().trim()) || null;

// Countries a drinker has "visited" through their glass.
export const originOf = (styleName) => findStyle(styleName)?.origin || null;
