/**
 * (c) 2010-2016 Torstein Honsi
 *
 * License: www.highcharts.com/license
 */
'use strict';
import H from './Globals.js';
import './Utilities.js';
import './Options.js';
import './Legend.js';
import './Point.js';
import './SvgRenderer.js';
var addEvent = H.addEvent,
	animObject = H.animObject,
	arrayMax = H.arrayMax,
	arrayMin = H.arrayMin,
	correctFloat = H.correctFloat,
	Date = H.Date,
	defaultOptions = H.defaultOptions,
	defaultPlotOptions = H.defaultPlotOptions,
	defined = H.defined,
	each = H.each,
	erase = H.erase,
	error = H.error,
	extend = H.extend,
	fireEvent = H.fireEvent,
	grep = H.grep,
	isArray = H.isArray,
	isNumber = H.isNumber,
	isString = H.isString,
	LegendSymbolMixin = H.LegendSymbolMixin, // @todo add as a requirement
	merge = H.merge,
	pick = H.pick,
	Point = H.Point, // @todo  add as a requirement
	removeEvent = H.removeEvent,
	splat = H.splat,
	stableSort = H.stableSort,
	SVGElement = H.SVGElement,
	syncTimeout = H.syncTimeout,
	win = H.win;

/**
 * The base function which all other series types inherit from. The data in the series is stored
 * in various arrays.
 *
 * - First, series.options.data contains all the original config options for
 * each point whether added by options or methods like series.addPoint.
 * - Next, series.data contains those values converted to points, but in case the series data length
 * exceeds the cropThreshold, or if the data is grouped, series.data doesn't contain all the points. It
 * only contains the points that have been created on demand.
 * - Then there's series.points that contains all currently visible point objects. In case of cropping,
 * the cropped-away points are not part of this array. The series.points array starts at series.cropStart
 * compared to series.data and series.options.data. If however the series data is grouped, these can't
 * be correlated one to one.
 * - series.xData and series.processedXData contain clean x values, equivalent to series.data and series.points.
 * - series.yData and series.processedYData contain clean y values, equivalent to series.data and series.points.
 *
 * @constructor Series
 * @param {Object} chart - The chart instance.
 * @param {Object} options - The series options.
 */
H.Series = H.seriesType('line', null, { // base series options
	/*= if (build.classic) { =*/
	//cursor: 'default',
	//dashStyle: null,
	//linecap: 'round',
	lineWidth: 2,
	//shadow: false,
	/*= } =*/
	allowPointSelect: false,
	showCheckbox: false,
	animation: {
		duration: 1000
	},
	//clip: true,
	//connectNulls: false,
	//enableMouseTracking: true,
	events: {},
	//legendIndex: 0,
	// stacking: null,
	marker: {
		/*= if (build.classic) { =*/
		lineWidth: 0,
		lineColor: '${palette.backgroundColor}',
		//fillColor: null,
		/*= } =*/				
		//enabled: true,
		//symbol: null,
		radius: 4,
		states: { // states for a single point
			hover: {
				animation: {
					duration: 50
				},
				enabled: true,
				radiusPlus: 2,
				/*= if (build.classic) { =*/
				lineWidthPlus: 1
				/*= } =*/
			},
			/*= if (build.classic) { =*/
			select: {
				fillColor: '${palette.neutralColor20}',
				lineColor: '${palette.neutralColor100}',
				lineWidth: 2
			}
			/*= } =*/
		}
	},
	point: {
		events: {}
	},
	dataLabels: {
		align: 'center',
		// defer: true,
		// enabled: false,
		formatter: function () {
			return this.y === null ? '' : H.numberFormat(this.y, -1);
		},
		/*= if (!build.classic) { =*/
		/*style: {
			color: 'contrast',
			textShadow: '0 0 6px contrast, 0 0 3px contrast'
		},*/
		/*= } else { =*/
		style: {
			fontSize: '11px',
			fontWeight: 'bold',
			color: 'contrast',
			textShadow: '1px 1px contrast, -1px -1px contrast, -1px 1px contrast, 1px -1px contrast'
		},
		// backgroundColor: undefined,
		// borderColor: undefined,
		// borderWidth: undefined,
		// shadow: false
		/*= } =*/
		verticalAlign: 'bottom', // above singular point
		x: 0,
		y: 0,
		// borderRadius: undefined,
		padding: 5
	},
	cropThreshold: 300, // draw points outside the plot area when the number of points is less than this
	pointRange: 0,
	//pointStart: 0,
	//pointInterval: 1,
	//showInLegend: null, // auto: true for standalone series, false for linked series
	softThreshold: true,
	states: { // states for the entire series
		hover: {
			//enabled: false,
			lineWidthPlus: 1,
			marker: {
				// lineWidth: base + 1,
				// radius: base + 1
			},
			halo: {
				size: 10,
				/*= if (build.classic) { =*/
				opacity: 0.25
				/*= } =*/
			}
		},
		select: {
			marker: {}
		}
	},
	stickyTracking: true,
	//tooltip: {
		//pointFormat: '<span style="color:{point.color}">\u25CF</span> {series.name}: <b>{point.y}</b>'
		//valueDecimals: null,
		//xDateFormat: '%A, %b %e, %Y',
		//valuePrefix: '',
		//ySuffix: ''
	//}
	turboThreshold: 1000
	// zIndex: null


}, /** @lends Series.prototype */ {
	isCartesian: true,
	pointClass: Point,
	sorted: true, // requires the data to be sorted
	requireSorting: true,
	directTouch: false,
	axisTypes: ['xAxis', 'yAxis'],
	colorCounter: 0,
	parallelArrays: ['x', 'y'], // each point's x and y values are stored in this.xData and this.yData
	coll: 'series',
	init: function (chart, options) {
		var series = this,
			eventType,
			events,
			chartSeries = chart.series,
			lastSeries,
			sortByIndex = function (a, b) {
				return pick(a.options.index, a._i) - pick(b.options.index, b._i);
			};

		series.chart = chart;
		series.options = options = series.setOptions(options); // merge with plotOptions
		series.linkedSeries = [];

		// bind the axes
		series.bindAxes();

		// set some variables
		extend(series, {
			name: options.name,
			state: '',
			visible: options.visible !== false, // true by default
			selected: options.selected === true // false by default
		});

		// register event listeners
		events = options.events;
		for (eventType in events) {
			addEvent(series, eventType, events[eventType]);
		}
		if (
			(events && events.click) ||
			(options.point && options.point.events && options.point.events.click) ||
			options.allowPointSelect
		) {
			chart.runTrackerClick = true;
		}

		series.getColor();
		series.getSymbol();

		// Set the data
		each(series.parallelArrays, function (key) {
			series[key + 'Data'] = [];
		});
		series.setData(options.data, false);

		// Mark cartesian
		if (series.isCartesian) {
			chart.hasCartesianSeries = true;
		}

		// Get the index and register the series in the chart. The index is one
		// more than the current latest series index (5960).
		lastSeries = chartSeries.length && chartSeries[chartSeries.length - 1];
		series._i = pick(lastSeries && lastSeries._i, -1) + 1;
		chartSeries.push(series);

		// Sort series according to index option (#248, #1123, #2456)
		stableSort(chartSeries, sortByIndex);
		if (this.yAxis) {
			stableSort(this.yAxis.series, sortByIndex);
		}

		each(chartSeries, function (series, i) {
			series.index = i;
			series.name = series.name || 'Series ' + (i + 1);
		});

	},

	/**
	 * Set the xAxis and yAxis properties of cartesian series, and register the
	 * series in the `axis.series` array.
	 *
	 * @function #bindAxes
	 * @memberOf Series
	 * @returns {void}
	 */
	bindAxes: function () {
		var series = this,
			seriesOptions = series.options,
			chart = series.chart,
			axisOptions;

		each(series.axisTypes || [], function (AXIS) { // repeat for xAxis and yAxis

			each(chart[AXIS], function (axis) { // loop through the chart's axis objects
				axisOptions = axis.options;

				// apply if the series xAxis or yAxis option mathches the number of the
				// axis, or if undefined, use the first axis
				if ((seriesOptions[AXIS] === axisOptions.index) ||
						(seriesOptions[AXIS] !== undefined && seriesOptions[AXIS] === axisOptions.id) ||
						(seriesOptions[AXIS] === undefined && axisOptions.index === 0)) {

					// register this series in the axis.series lookup
					axis.series.push(series);

					// set this series.xAxis or series.yAxis reference
					series[AXIS] = axis;

					// mark dirty for redraw
					axis.isDirty = true;
				}
			});

			// The series needs an X and an Y axis
			if (!series[AXIS] && series.optionalAxis !== AXIS) {
				error(18, true);
			}

		});
	},

	/**
	 * For simple series types like line and column, the data values are held in arrays like
	 * xData and yData for quick lookup to find extremes and more. For multidimensional series
	 * like bubble and map, this can be extended with arrays like zData and valueData by
	 * adding to the series.parallelArrays array.
	 */
	updateParallelArrays: function (point, i) {
		var series = point.series,
			args = arguments,
			fn = isNumber(i) ?
				// Insert the value in the given position
				function (key) {
					var val = key === 'y' && series.toYData ? series.toYData(point) : point[key];
					series[key + 'Data'][i] = val;
				} :
				// Apply the method specified in i with the following arguments as arguments
				function (key) {
					Array.prototype[i].apply(series[key + 'Data'], Array.prototype.slice.call(args, 2));
				};

		each(series.parallelArrays, fn);
	},

	/**
	 * Return an auto incremented x value based on the pointStart and pointInterval options.
	 * This is only used if an x value is not given for the point that calls autoIncrement.
	 */
	autoIncrement: function () {

		var options = this.options,
			xIncrement = this.xIncrement,
			date,
			pointInterval,
			pointIntervalUnit = options.pointIntervalUnit;

		xIncrement = pick(xIncrement, options.pointStart, 0);

		this.pointInterval = pointInterval = pick(this.pointInterval, options.pointInterval, 1);

		// Added code for pointInterval strings
		if (pointIntervalUnit) {
			date = new Date(xIncrement);

			if (pointIntervalUnit === 'day') {
				date = +date[Date.hcSetDate](date[Date.hcGetDate]() + pointInterval);
			} else if (pointIntervalUnit === 'month') {
				date = +date[Date.hcSetMonth](date[Date.hcGetMonth]() + pointInterval);
			} else if (pointIntervalUnit === 'year') {
				date = +date[Date.hcSetFullYear](date[Date.hcGetFullYear]() + pointInterval);
			}
			pointInterval = date - xIncrement;

		}

		this.xIncrement = xIncrement + pointInterval;
		return xIncrement;
	},
	
	/**
	 * Set the series options by merging from the options tree
	 * @param {Object} itemOptions
	 */
	setOptions: function (itemOptions) {
		var chart = this.chart,
			chartOptions = chart.options,
			plotOptions = chartOptions.plotOptions,
			userOptions = chart.userOptions || {},
			userPlotOptions = userOptions.plotOptions || {},
			typeOptions = plotOptions[this.type],
			options,
			zones;

		this.userOptions = itemOptions;

		// General series options take precedence over type options because otherwise, default
		// type options like column.animation would be overwritten by the general option.
		// But issues have been raised here (#3881), and the solution may be to distinguish
		// between default option and userOptions like in the tooltip below.
		options = merge(
			typeOptions,
			plotOptions.series,
			itemOptions
		);

		// The tooltip options are merged between global and series specific options
		this.tooltipOptions = merge(
			defaultOptions.tooltip,
			defaultOptions.plotOptions[this.type].tooltip,
			userOptions.tooltip,
			userPlotOptions.series && userPlotOptions.series.tooltip,
			userPlotOptions[this.type] && userPlotOptions[this.type].tooltip,
			itemOptions.tooltip
		);

		// Delete marker object if not allowed (#1125)
		if (typeOptions.marker === null) {
			delete options.marker;
		}

		// Handle color zones
		this.zoneAxis = options.zoneAxis;
		zones = this.zones = (options.zones || []).slice();
		if ((options.negativeColor || options.negativeFillColor) && !options.zones) {
			zones.push({
				value: options[this.zoneAxis + 'Threshold'] || options.threshold || 0,
				className: 'highcharts-negative',
				/*= if (build.classic) { =*/
				color: options.negativeColor,
				fillColor: options.negativeFillColor
				/*= } =*/
			});
		}
		if (zones.length) { // Push one extra zone for the rest
			if (defined(zones[zones.length - 1].value)) {
				zones.push({
					/*= if (build.classic) { =*/
					color: this.color,
					fillColor: this.fillColor
					/*= } =*/
				});
			}
		}
		return options;
	},

	getCyclic: function (prop, value, defaults) {
		var i,
			userOptions = this.userOptions,
			indexName = prop + 'Index',
			counterName = prop + 'Counter',
			len = defaults ? defaults.length : pick(this.chart.options.chart[prop + 'Count'], this.chart[prop + 'Count']),
			setting;

		if (!value) {
			// Pick up either the colorIndex option, or the _colorIndex after Series.update()
			setting = pick(userOptions[indexName], userOptions['_' + indexName]);
			if (defined(setting)) { // after Series.update()
				i = setting;
			} else {
				userOptions['_' + indexName] = i = this.chart[counterName] % len;
				this.chart[counterName] += 1;
			}
			if (defaults) {
				value = defaults[i];
			}
		}
		// Set the colorIndex
		if (i !== undefined) {
			this[indexName] = i;
		}
		this[prop] = value;
	},

	/**
	 * Get the series' color
	 */
	/*= if (!build.classic) { =*/
	getColor: function () {
		this.getCyclic('color');
	},

	/*= } else { =*/
	getColor: function () {
		if (this.options.colorByPoint) {
			this.options.color = null; // #4359, selected slice got series.color even when colorByPoint was set.
		} else {
			this.getCyclic('color', this.options.color || defaultPlotOptions[this.type].color, this.chart.options.colors);
		}
	},
	/*= } =*/
	/**
	 * Get the series' symbol
	 */
	getSymbol: function () {
		var seriesMarkerOption = this.options.marker;

		this.getCyclic('symbol', seriesMarkerOption.symbol, this.chart.options.symbols);
	},

	drawLegendSymbol: LegendSymbolMixin.drawLineMarker,

	/**
	 * Replace the series data with a new set of data
	 * @param {Object} data
	 * @param {Object} redraw
	 */
	setData: function (data, redraw, animation, updatePoints) {
		var series = this,
			oldData = series.points,
			oldDataLength = (oldData && oldData.length) || 0,
			dataLength,
			options = series.options,
			chart = series.chart,
			firstPoint = null,
			xAxis = series.xAxis,
			i,
			turboThreshold = options.turboThreshold,
			pt,
			xData = this.xData,
			yData = this.yData,
			pointArrayMap = series.pointArrayMap,
			valueCount = pointArrayMap && pointArrayMap.length;

		data = data || [];
		dataLength = data.length;
		redraw = pick(redraw, true);

		// If the point count is the same as is was, just run Point.update which is
		// cheaper, allows animation, and keeps references to points.
		if (updatePoints !== false && dataLength && oldDataLength === dataLength && !series.cropped && !series.hasGroupedData && series.visible) {
			each(data, function (point, i) {
				// .update doesn't exist on a linked, hidden series (#3709)
				if (oldData[i].update && point !== options.data[i]) {
					oldData[i].update(point, false, null, false);
				}
			});

		} else {

			// Reset properties
			series.xIncrement = null;

			series.colorCounter = 0; // for series with colorByPoint (#1547)

			// Update parallel arrays
			each(this.parallelArrays, function (key) {
				series[key + 'Data'].length = 0;
			});

			// In turbo mode, only one- or twodimensional arrays of numbers are allowed. The
			// first value is tested, and we assume that all the rest are defined the same
			// way. Although the 'for' loops are similar, they are repeated inside each
			// if-else conditional for max performance.
			if (turboThreshold && dataLength > turboThreshold) {

				// find the first non-null point
				i = 0;
				while (firstPoint === null && i < dataLength) {
					firstPoint = data[i];
					i++;
				}


				if (isNumber(firstPoint)) { // assume all points are numbers
					for (i = 0; i < dataLength; i++) {
						xData[i] = this.autoIncrement();
						yData[i] = data[i];
					}
				} else if (isArray(firstPoint)) { // assume all points are arrays
					if (valueCount) { // [x, low, high] or [x, o, h, l, c]
						for (i = 0; i < dataLength; i++) {
							pt = data[i];
							xData[i] = pt[0];
							yData[i] = pt.slice(1, valueCount + 1);
						}
					} else { // [x, y]
						for (i = 0; i < dataLength; i++) {
							pt = data[i];
							xData[i] = pt[0];
							yData[i] = pt[1];
						}
					}
				} else {
					error(12); // Highcharts expects configs to be numbers or arrays in turbo mode
				}
			} else {
				for (i = 0; i < dataLength; i++) {
					if (data[i] !== undefined) { // stray commas in oldIE
						pt = { series: series };
						series.pointClass.prototype.applyOptions.apply(pt, [data[i]]);
						series.updateParallelArrays(pt, i);
					}
				}
			}

			// Forgetting to cast strings to numbers is a common caveat when handling CSV or JSON
			if (isString(yData[0])) {
				error(14, true);
			}

			series.data = [];
			series.options.data = series.userOptions.data = data;

			// destroy old points
			i = oldDataLength;
			while (i--) {
				if (oldData[i] && oldData[i].destroy) {
					oldData[i].destroy();
				}
			}

			// reset minRange (#878)
			if (xAxis) {
				xAxis.minRange = xAxis.userMinRange;
			}

			// redraw
			series.isDirty = chart.isDirtyBox = true;
			series.isDirtyData = !!oldData;
			animation = false;
		}

		// Typically for pie series, points need to be processed and generated
		// prior to rendering the legend
		if (options.legendType === 'point') {
			this.processData();
			this.generatePoints();
		}

		if (redraw) {
			chart.redraw(animation);
		}
	},

	/**
	 * Process the data by cropping away unused data points if the series is longer
	 * than the crop threshold. This saves computing time for lage series.
	 */
	processData: function (force) {
		var series = this,
			processedXData = series.xData, // copied during slice operation below
			processedYData = series.yData,
			dataLength = processedXData.length,
			croppedData,
			cropStart = 0,
			cropped,
			distance,
			closestPointRange,
			xAxis = series.xAxis,
			i, // loop variable
			options = series.options,
			cropThreshold = options.cropThreshold,
			getExtremesFromAll = series.getExtremesFromAll || options.getExtremesFromAll, // #4599
			isCartesian = series.isCartesian,
			xExtremes,
			val2lin = xAxis && xAxis.val2lin,
			isLog = xAxis && xAxis.isLog,
			min,
			max;

		// If the series data or axes haven't changed, don't go through this. Return false to pass
		// the message on to override methods like in data grouping.
		if (isCartesian && !series.isDirty && !xAxis.isDirty && !series.yAxis.isDirty && !force) {
			return false;
		}

		if (xAxis) {
			xExtremes = xAxis.getExtremes(); // corrected for log axis (#3053)
			min = xExtremes.min;
			max = xExtremes.max;
		}

		// optionally filter out points outside the plot area
		if (isCartesian && series.sorted && !getExtremesFromAll && (!cropThreshold || dataLength > cropThreshold || series.forceCrop)) {

			// it's outside current extremes
			if (processedXData[dataLength - 1] < min || processedXData[0] > max) {
				processedXData = [];
				processedYData = [];

			// only crop if it's actually spilling out
			} else if (processedXData[0] < min || processedXData[dataLength - 1] > max) {
				croppedData = this.cropData(series.xData, series.yData, min, max);
				processedXData = croppedData.xData;
				processedYData = croppedData.yData;
				cropStart = croppedData.start;
				cropped = true;
			}
		}


		// Find the closest distance between processed points
		i = processedXData.length || 1;
		while (--i) {
			distance = isLog ?
				val2lin(processedXData[i]) - val2lin(processedXData[i - 1]) :
				processedXData[i] - processedXData[i - 1];

			if (distance > 0 && (closestPointRange === undefined || distance < closestPointRange)) {
				closestPointRange = distance;

			// Unsorted data is not supported by the line tooltip, as well as data grouping and
			// navigation in Stock charts (#725) and width calculation of columns (#1900)
			} else if (distance < 0 && series.requireSorting) {
				error(15);
			}
		}

		// Record the properties
		series.cropped = cropped; // undefined or true
		series.cropStart = cropStart;
		series.processedXData = processedXData;
		series.processedYData = processedYData;

		series.closestPointRange = closestPointRange;

	},

	/**
	 * Iterate over xData and crop values between min and max. Returns object containing crop start/end
	 * cropped xData with corresponding part of yData, dataMin and dataMax within the cropped range
	 */
	cropData: function (xData, yData, min, max) {
		var dataLength = xData.length,
			cropStart = 0,
			cropEnd = dataLength,
			cropShoulder = pick(this.cropShoulder, 1), // line-type series need one point outside
			i,
			j;

		// iterate up to find slice start
		for (i = 0; i < dataLength; i++) {
			if (xData[i] >= min) {
				cropStart = Math.max(0, i - cropShoulder);
				break;
			}
		}

		// proceed to find slice end
		for (j = i; j < dataLength; j++) {
			if (xData[j] > max) {
				cropEnd = j + cropShoulder;
				break;
			}
		}

		return {
			xData: xData.slice(cropStart, cropEnd),
			yData: yData.slice(cropStart, cropEnd),
			start: cropStart,
			end: cropEnd
		};
	},


	/**
	 * Generate the data point after the data has been processed by cropping away
	 * unused points and optionally grouped in Highcharts Stock.
	 */
	generatePoints: function () {
		var series = this,
			options = series.options,
			dataOptions = options.data,
			data = series.data,
			dataLength,
			processedXData = series.processedXData,
			processedYData = series.processedYData,
			PointClass = series.pointClass,
			processedDataLength = processedXData.length,
			cropStart = series.cropStart || 0,
			cursor,
			hasGroupedData = series.hasGroupedData,
			point,
			points = [],
			i;

		if (!data && !hasGroupedData) {
			var arr = [];
			arr.length = dataOptions.length;
			data = series.data = arr;
		}

		for (i = 0; i < processedDataLength; i++) {
			cursor = cropStart + i;
			if (!hasGroupedData) {
				if (data[cursor]) {
					point = data[cursor];
				} else if (dataOptions[cursor] !== undefined) { // #970
					data[cursor] = point = (new PointClass()).init(series, dataOptions[cursor], processedXData[i]);
				}
				points[i] = point;
			} else {
				// splat the y data in case of ohlc data array
				points[i] = (new PointClass()).init(series, [processedXData[i]].concat(splat(processedYData[i])));
				points[i].dataGroup = series.groupMap[i];
			}
			points[i].index = cursor; // For faster access in Point.update
		}

		// Hide cropped-away points - this only runs when the number of points is above cropThreshold, or when
		// swithching view from non-grouped data to grouped data (#637)
		if (data && (processedDataLength !== (dataLength = data.length) || hasGroupedData)) {
			for (i = 0; i < dataLength; i++) {
				if (i === cropStart && !hasGroupedData) { // when has grouped data, clear all points
					i += processedDataLength;
				}
				if (data[i]) {
					data[i].destroyElements();
					data[i].plotX = undefined; // #1003
				}
			}
		}

		series.data = data;
		series.points = points;
	},

	/**
	 * Calculate Y extremes for visible data
	 */
	getExtremes: function (yData) {
		var xAxis = this.xAxis,
			yAxis = this.yAxis,
			xData = this.processedXData,
			yDataLength,
			activeYData = [],
			activeCounter = 0,
			xExtremes = xAxis.getExtremes(), // #2117, need to compensate for log X axis
			xMin = xExtremes.min,
			xMax = xExtremes.max,
			validValue,
			withinRange,
			x,
			y,
			i,
			j;

		yData = yData || this.stackedYData || this.processedYData || [];
		yDataLength = yData.length;

		for (i = 0; i < yDataLength; i++) {

			x = xData[i];
			y = yData[i];

			// For points within the visible range, including the first point outside the
			// visible range, consider y extremes
			validValue = (isNumber(y, true) || isArray(y)) && (!yAxis.isLog || (y.length || y > 0));
			withinRange = this.getExtremesFromAll || this.options.getExtremesFromAll || this.cropped ||
				((xData[i + 1] || x) >= xMin &&	(xData[i - 1] || x) <= xMax);

			if (validValue && withinRange) {

				j = y.length;
				if (j) { // array, like ohlc or range data
					while (j--) {
						if (y[j] !== null) {
							activeYData[activeCounter++] = y[j];
						}
					}
				} else {
					activeYData[activeCounter++] = y;
				}
			}
		}
		this.dataMin = arrayMin(activeYData);
		this.dataMax = arrayMax(activeYData);
	},

	/**
	 * Translate data points from raw data values to chart specific positioning
	 * data needed later in drawPoints, drawGraph and drawTracker.
	 *
	 * @function #translate
	 * @memberOf Series
	 * @returns {void}
	 */
	translate: function () {
		if (!this.processedXData) { // hidden series
			this.processData();
		}
		this.generatePoints();
		var series = this,
			options = series.options,
			stacking = options.stacking,
			xAxis = series.xAxis,
			categories = xAxis.categories,
			yAxis = series.yAxis,
			points = series.points,
			dataLength = points.length,
			hasModifyValue = !!series.modifyValue,
			i,
			pointPlacement = options.pointPlacement,
			dynamicallyPlaced = pointPlacement === 'between' || isNumber(pointPlacement),
			threshold = options.threshold,
			stackThreshold = options.startFromThreshold ? threshold : 0,
			plotX,
			plotY,
			lastPlotX,
			stackIndicator,
			closestPointRangePx = Number.MAX_VALUE;

		// Point placement is relative to each series pointRange (#5889)
		if (pointPlacement === 'between') {
			pointPlacement = 0.5;
		}
		if (isNumber(pointPlacement)) {
			pointPlacement *= pick(options.pointRange || xAxis.pointRange);
		}

		// Translate each point
		for (i = 0; i < dataLength; i++) {
			var point = points[i],
				xValue = point.x,
				yValue = point.y,
				yBottom = point.low,
				stack = stacking && yAxis.stacks[(series.negStacks && yValue < (stackThreshold ? 0 : threshold) ? '-' : '') + series.stackKey],
				pointStack,
				stackValues;

			// Discard disallowed y values for log axes (#3434)
			if (yAxis.isLog && yValue !== null && yValue <= 0) {
				point.isNull = true;
			}

			// Get the plotX translation
			point.plotX = plotX = correctFloat( // #5236
				Math.min(Math.max(-1e5, xAxis.translate(
					xValue,
					0,
					0,
					0,
					1,
					pointPlacement,
					this.type === 'flags'
				)), 1e5) // #3923
			);
			
			// Calculate the bottom y value for stacked series
			if (stacking && series.visible && !point.isNull && stack && stack[xValue]) {
				stackIndicator = series.getStackIndicator(stackIndicator, xValue, series.index);
				pointStack = stack[xValue];
				stackValues = pointStack.points[stackIndicator.key];
				yBottom = stackValues[0];
				yValue = stackValues[1];

				if (yBottom === stackThreshold && stackIndicator.key === stack[xValue].base) {
					yBottom = pick(threshold, yAxis.min);
				}
				if (yAxis.isLog && yBottom <= 0) { // #1200, #1232
					yBottom = null;
				}

				point.total = point.stackTotal = pointStack.total;
				point.percentage = pointStack.total && (point.y / pointStack.total * 100);
				point.stackY = yValue;

				// Place the stack label
				pointStack.setOffset(series.pointXOffset || 0, series.barW || 0);

			}

			// Set translated yBottom or remove it
			point.yBottom = defined(yBottom) ?
				yAxis.translate(yBottom, 0, 1, 0, 1) :
				null;

			// general hook, used for Highstock compare mode
			if (hasModifyValue) {
				yValue = series.modifyValue(yValue, point);
			}

			// Set the the plotY value, reset it for redraws
			point.plotY = plotY = (typeof yValue === 'number' && yValue !== Infinity) ?
				Math.min(Math.max(-1e5, yAxis.translate(yValue, 0, 1, 0, 1)), 1e5) : // #3201
				undefined;

			point.isInside = plotY !== undefined && plotY >= 0 && plotY <= yAxis.len && // #3519
				plotX >= 0 && plotX <= xAxis.len;


			// Set client related positions for mouse tracking
			point.clientX = dynamicallyPlaced ? correctFloat(xAxis.translate(xValue, 0, 0, 0, 1, pointPlacement)) : plotX; // #1514, #5383, #5518

			point.negative = point.y < (threshold || 0);

			// some API data
			point.category = categories && categories[point.x] !== undefined ?
				categories[point.x] : point.x;

			// Determine auto enabling of markers (#3635, #5099)
			if (!point.isNull) {
				if (lastPlotX !== undefined) {
					closestPointRangePx = Math.min(closestPointRangePx, Math.abs(plotX - lastPlotX));
				}
				lastPlotX = plotX;
			}

		}
		series.closestPointRangePx = closestPointRangePx;
	},

	/**
	 * Return the series points with null points filtered out
	 */
	getValidPoints: function (points, insideOnly) {
		var chart = this.chart;
		return grep(points || this.points || [], function isValidPoint(point) { // #3916, #5029
			if (insideOnly && !chart.isInsidePlot(point.plotX, point.plotY, chart.inverted)) { // #5085
				return false;
			}
			return !point.isNull;
		});
	},

	/**
	 * Set the clipping for the series. For animated series it is called twice, first to initiate
	 * animating the clip then the second time without the animation to set the final clip.
	 */
	setClip: function (animation) {
		var chart = this.chart,
			options = this.options,
			renderer = chart.renderer,
			inverted = chart.inverted,
			seriesClipBox = this.clipBox,
			clipBox = seriesClipBox || chart.clipBox,
			sharedClipKey = this.sharedClipKey || ['_sharedClip', animation && animation.duration, animation && animation.easing, clipBox.height, options.xAxis, options.yAxis].join(','), // #4526
			clipRect = chart[sharedClipKey],
			markerClipRect = chart[sharedClipKey + 'm'];

		// If a clipping rectangle with the same properties is currently present in the chart, use that.
		if (!clipRect) {

			// When animation is set, prepare the initial positions
			if (animation) {
				clipBox.width = 0;

				chart[sharedClipKey + 'm'] = markerClipRect = renderer.clipRect(
					-99, // include the width of the first marker
					inverted ? -chart.plotLeft : -chart.plotTop,
					99,
					inverted ? chart.chartWidth : chart.chartHeight
				);
			}
			chart[sharedClipKey] = clipRect = renderer.clipRect(clipBox);
			// Create hashmap for series indexes
			clipRect.count = { length: 0 };

		}
		if (animation) {
			if (!clipRect.count[this.index]) {
				clipRect.count[this.index] = true;
				clipRect.count.length += 1;
			}
		}

		if (options.clip !== false) {
			this.group.clip(animation || seriesClipBox ? clipRect : chart.clipRect);
			this.markerGroup.clip(markerClipRect);
			this.sharedClipKey = sharedClipKey;
		}

		// Remove the shared clipping rectangle when all series are shown
		if (!animation) {
			if (clipRect.count[this.index]) {
				delete clipRect.count[this.index];
				clipRect.count.length -= 1;
			}

			if (clipRect.count.length === 0 && sharedClipKey && chart[sharedClipKey]) {
				if (!seriesClipBox) {
					chart[sharedClipKey] = chart[sharedClipKey].destroy();
				}
				if (chart[sharedClipKey + 'm']) {
					chart[sharedClipKey + 'm'] = chart[sharedClipKey + 'm'].destroy();
				}
			}
		}
	},

	/**
	 * Animate in the series
	 */
	animate: function (init) {
		var series = this,
			chart = series.chart,
			clipRect,
			animation = animObject(series.options.animation),
			sharedClipKey;

		// Initialize the animation. Set up the clipping rectangle.
		if (init) {

			series.setClip(animation);

		// Run the animation
		} else {
			sharedClipKey = this.sharedClipKey;
			clipRect = chart[sharedClipKey];
			if (clipRect) {
				clipRect.animate({
					width: chart.plotSizeX
				}, animation);
			}
			if (chart[sharedClipKey + 'm']) {
				chart[sharedClipKey + 'm'].animate({
					width: chart.plotSizeX + 99
				}, animation);
			}

			// Delete this function to allow it only once
			series.animate = null;

		}
	},

	/**
	 * This runs after animation to land on the final plot clipping
	 */
	afterAnimate: function () {
		this.setClip();
		fireEvent(this, 'afterAnimate');
	},

	/**
	 * Draw the markers.
	 *
	 * @function #drawPoints
	 * @memberOf Series
	 * @returns {void}
	 */
	drawPoints: function () {
		var series = this,
			points = series.points,
			chart = series.chart,
			plotY,
			i,
			point,
			symbol,
			graphic,
			options = series.options,
			seriesMarkerOptions = options.marker,
			pointMarkerOptions,
			hasPointMarker,
			enabled,
			isInside,
			markerGroup = series.markerGroup,
			xAxis = series.xAxis,
			markerAttribs,
			globallyEnabled = pick(
				seriesMarkerOptions.enabled,
				xAxis.isRadial ? true : null,
				series.closestPointRangePx > 2 * seriesMarkerOptions.radius
			);

		if (seriesMarkerOptions.enabled !== false || series._hasPointMarkers) {

			i = points.length;
			while (i--) {
				point = points[i];
				plotY = point.plotY;
				graphic = point.graphic;
				pointMarkerOptions = point.marker || {};
				hasPointMarker = !!point.marker;
				enabled = (globallyEnabled && pointMarkerOptions.enabled === undefined) || pointMarkerOptions.enabled;
				isInside = point.isInside;

				// only draw the point if y is defined
				if (enabled && isNumber(plotY) && point.y !== null) {

					// Shortcuts
					symbol = pick(pointMarkerOptions.symbol, series.symbol);
					point.hasImage = symbol.indexOf('url') === 0;

					markerAttribs = series.markerAttribs(
						point,
						point.selected && 'select'
					);

					if (graphic) { // update
						graphic[isInside ? 'show' : 'hide'](true) // Since the marker group isn't clipped, each individual marker must be toggled
							.animate(markerAttribs);
					} else if (isInside && (markerAttribs.width > 0 || point.hasImage)) {
						point.graphic = graphic = chart.renderer.symbol(
							symbol,
							markerAttribs.x,
							markerAttribs.y,
							markerAttribs.width,
							markerAttribs.height,
							hasPointMarker ? pointMarkerOptions : seriesMarkerOptions
						)
						.add(markerGroup);
					}

					/*= if (build.classic) { =*/
					// Presentational attributes
					if (graphic) {
						graphic.attr(series.pointAttribs(point, point.selected && 'select'));
					}
					/*= } =*/

					if (graphic) {
						graphic.addClass(point.getClassName(), true);
					}

				} else if (graphic) {
					point.graphic = graphic.destroy(); // #1269
				}
			}
		}

	},

	/**
	 * Get non-presentational attributes for the point.
	 */
	markerAttribs: function (point, state) {
		var seriesMarkerOptions = this.options.marker,
			seriesStateOptions,
			pointOptions = point && point.options,
			pointMarkerOptions = (pointOptions && pointOptions.marker) || {},
			pointStateOptions,
			radius = pick(
				pointMarkerOptions.radius,
				seriesMarkerOptions.radius
			),
			attribs;

		// Handle hover and select states
		if (state) {
			seriesStateOptions = seriesMarkerOptions.states[state];
			pointStateOptions = pointMarkerOptions.states &&
				pointMarkerOptions.states[state];

			radius = pick(
				pointStateOptions && pointStateOptions.radius,
				seriesStateOptions && seriesStateOptions.radius,
				radius + (seriesStateOptions && seriesStateOptions.radiusPlus || 0)
			);
		}

		if (point.hasImage) {
			radius = 0; // and subsequently width and height is not set
		}

		attribs = {
			x: Math.floor(point.plotX) - radius, // Math.floor for #1843
			y: point.plotY - radius
		};

		if (radius) {
			attribs.width = attribs.height = 2 * radius;
		}

		return attribs;
		
	},

	/*= if (build.classic) { =*/
	/**
	 * Get presentational attributes for marker-based series (line, spline, scatter, bubble, mappoint...)
	 */
	pointAttribs: function (point, state) {
		var seriesMarkerOptions = this.options.marker,
			seriesStateOptions,
			pointOptions = point && point.options,
			pointMarkerOptions = (pointOptions && pointOptions.marker) || {},
			pointStateOptions,
			color = this.color,
			pointColorOption = pointOptions && pointOptions.color,
			pointColor = point && point.color,
			strokeWidth = pick(
				pointMarkerOptions.lineWidth,
				seriesMarkerOptions.lineWidth
			),
			zoneColor,
			fill,
			stroke,
			zone;

		if (point && this.zones.length) {
			zone = point.getZone();
			if (zone && zone.color) {
				zoneColor = zone.color;
			}
		}

		color = pointColorOption || zoneColor || pointColor || color;
		fill = pointMarkerOptions.fillColor || seriesMarkerOptions.fillColor || color;
		stroke = pointMarkerOptions.lineColor || seriesMarkerOptions.lineColor || color;

		// Handle hover and select states
		if (state) {
			seriesStateOptions = seriesMarkerOptions.states[state];
			pointStateOptions = (pointMarkerOptions.states && pointMarkerOptions.states[state]) || {};
			strokeWidth = pick(
				pointStateOptions.lineWidth, 
				seriesStateOptions.lineWidth, 
				strokeWidth + pick(
					pointStateOptions.lineWidthPlus, 
					seriesStateOptions.lineWidthPlus,
					0
				)
			);
			fill = pointStateOptions.fillColor || seriesStateOptions.fillColor || fill;
			stroke = pointStateOptions.lineColor || seriesStateOptions.lineColor || stroke;
		}
		
		return {
			'stroke': stroke,
			'stroke-width': strokeWidth,
			'fill': fill
		};
	},
	/*= } =*/
	/**
	 * Clear DOM objects and free up memory
	 */
	destroy: function () {
		var series = this,
			chart = series.chart,
			issue134 = /AppleWebKit\/533/.test(win.navigator.userAgent),
			destroy,
			i,
			data = series.data || [],
			point,
			prop,
			axis;

		// add event hook
		fireEvent(series, 'destroy');

		// remove all events
		removeEvent(series);

		// erase from axes
		each(series.axisTypes || [], function (AXIS) {
			axis = series[AXIS];
			if (axis && axis.series) {
				erase(axis.series, series);
				axis.isDirty = axis.forceRedraw = true;
			}
		});

		// remove legend items
		if (series.legendItem) {
			series.chart.legend.destroyItem(series);
		}

		// destroy all points with their elements
		i = data.length;
		while (i--) {
			point = data[i];
			if (point && point.destroy) {
				point.destroy();
			}
		}
		series.points = null;

		// Clear the animation timeout if we are destroying the series during initial animation
		clearTimeout(series.animationTimeout);

		// Destroy all SVGElements associated to the series
		for (prop in series) {
			if (series[prop] instanceof SVGElement && !series[prop].survive) { // Survive provides a hook for not destroying

				// issue 134 workaround
				destroy = issue134 && prop === 'group' ?
					'hide' :
					'destroy';

				series[prop][destroy]();
			}
		}

		// remove from hoverSeries
		if (chart.hoverSeries === series) {
			chart.hoverSeries = null;
		}
		erase(chart.series, series);

		// clear all members
		for (prop in series) {
			delete series[prop];
		}
	},

	/**
	 * Get the graph path
	 */
	getGraphPath: function (points, nullsAsZeroes, connectCliffs) {
		var series = this,
			options = series.options,
			step = options.step,
			reversed,
			graphPath = [],
			xMap = [],
			gap;

		points = points || series.points;

		// Bottom of a stack is reversed
		reversed = points.reversed;
		if (reversed) {
			points.reverse();
		}
		// Reverse the steps (#5004)
		step = { right: 1, center: 2 }[step] || (step && 3);
		if (step && reversed) {
			step = 4 - step;
		}

		// Remove invalid points, especially in spline (#5015)
		if (options.connectNulls && !nullsAsZeroes && !connectCliffs) {
			points = this.getValidPoints(points);
		}

		// Build the line
		each(points, function (point, i) {

			var plotX = point.plotX,
				plotY = point.plotY,
				lastPoint = points[i - 1],
				pathToPoint; // the path to this point from the previous

			if ((point.leftCliff || (lastPoint && lastPoint.rightCliff)) && !connectCliffs) {
				gap = true; // ... and continue
			}

			// Line series, nullsAsZeroes is not handled
			if (point.isNull && !defined(nullsAsZeroes) && i > 0) {
				gap = !options.connectNulls;

			// Area series, nullsAsZeroes is set
			} else if (point.isNull && !nullsAsZeroes) {
				gap = true;

			} else {

				if (i === 0 || gap) {
					pathToPoint = ['M', point.plotX, point.plotY];
				
				} else if (series.getPointSpline) { // generate the spline as defined in the SplineSeries object
					
					pathToPoint = series.getPointSpline(points, point, i);

				} else if (step) {

					if (step === 1) { // right
						pathToPoint = [
							'L',
							lastPoint.plotX,
							plotY
						];
						
					} else if (step === 2) { // center
						pathToPoint = [
							'L',
							(lastPoint.plotX + plotX) / 2,
							lastPoint.plotY,
							'L',
							(lastPoint.plotX + plotX) / 2,
							plotY
						];
						
					} else {
						pathToPoint = [
							'L',
							plotX,
							lastPoint.plotY
						];
					}
					pathToPoint.push('L', plotX, plotY);

				} else {
					// normal line to next point
					pathToPoint = [
						'L',
						plotX,
						plotY
					];
				}

				// Prepare for animation. When step is enabled, there are two path nodes for each x value.
				xMap.push(point.x);
				if (step) {
					xMap.push(point.x);
				}

				graphPath.push.apply(graphPath, pathToPoint);
				gap = false;
			}
		});

		graphPath.xMap = xMap;
		series.graphPath = graphPath;

		return graphPath;

	},

	/**
	 * Draw the actual graph
	 */
	drawGraph: function () {
		var series = this,
			options = this.options,
			graphPath = (this.gappedPath || this.getGraphPath).call(this),
			props = [[
				'graph', 
				'highcharts-graph', 
				/*= if (build.classic) { =*/
				options.lineColor || this.color, 
				options.dashStyle
				/*= } =*/
			]];

		// Add the zone properties if any
		each(this.zones, function (zone, i) {
			props.push([
				'zone-graph-' + i,
				'highcharts-graph highcharts-zone-graph-' + i + ' ' + (zone.className || ''),
				/*= if (build.classic) { =*/
				zone.color || series.color, 
				zone.dashStyle || options.dashStyle
				/*= } =*/
			]);
		});

		// Draw the graph
		each(props, function (prop, i) {
			var graphKey = prop[0],
				graph = series[graphKey],
				attribs;

			if (graph) {
				graph.endX = graphPath.xMap;
				graph.animate({ d: graphPath });

			} else if (graphPath.length) { // #1487
				
				series[graphKey] = series.chart.renderer.path(graphPath)
					.addClass(prop[1])
					.attr({ zIndex: 1 }) // #1069
					.add(series.group);

				/*= if (build.classic) { =*/
				attribs = {
					'stroke': prop[2],
					'stroke-width': options.lineWidth,
					'fill': (series.fillGraph && series.color) || 'none' // Polygon series use filled graph
				};

				if (prop[3]) {
					attribs.dashstyle = prop[3];
				} else if (options.linecap !== 'square') {
					attribs['stroke-linecap'] = attribs['stroke-linejoin'] = 'round';
				}

				graph = series[graphKey]
					.attr(attribs)
					.shadow((i < 2) && options.shadow); // add shadow to normal series (0) or to first zone (1) #3932
				/*= } =*/
			}

			// Helpers for animation
			if (graph) {
				graph.startX = graphPath.xMap;
				//graph.shiftUnit = options.step ? 2 : 1;
				graph.isArea = graphPath.isArea; // For arearange animation
			}
		});
	},

	/**
	 * Clip the graphs into the positive and negative coloured graphs
	 */
	applyZones: function () {
		var series = this,
			chart = this.chart,
			renderer = chart.renderer,
			zones = this.zones,
			translatedFrom,
			translatedTo,
			clips = this.clips || [],
			clipAttr,
			graph = this.graph,
			area = this.area,
			chartSizeMax = Math.max(chart.chartWidth, chart.chartHeight),
			axis = this[(this.zoneAxis || 'y') + 'Axis'],
			extremes,
			reversed,
			inverted = chart.inverted,
			horiz,
			pxRange,
			pxPosMin,
			pxPosMax,
			ignoreZones = false;

		if (zones.length && (graph || area) && axis && axis.min !== undefined) {
			reversed = axis.reversed;
			horiz = axis.horiz;
			// The use of the Color Threshold assumes there are no gaps
			// so it is safe to hide the original graph and area
			if (graph) {
				graph.hide();
			}
			if (area) {
				area.hide();
			}

			// Create the clips
			extremes = axis.getExtremes();
			each(zones, function (threshold, i) {

				translatedFrom = reversed ?
					(horiz ? chart.plotWidth : 0) :
					(horiz ? 0 : axis.toPixels(extremes.min));
				translatedFrom = Math.min(Math.max(pick(translatedTo, translatedFrom), 0), chartSizeMax);
				translatedTo = Math.min(Math.max(Math.round(axis.toPixels(pick(threshold.value, extremes.max), true)), 0), chartSizeMax);
				
				if (ignoreZones) {
					translatedFrom = translatedTo = axis.toPixels(extremes.max);
				}

				pxRange = Math.abs(translatedFrom - translatedTo);
				pxPosMin = Math.min(translatedFrom, translatedTo);
				pxPosMax = Math.max(translatedFrom, translatedTo);
				if (axis.isXAxis) {
					clipAttr = {
						x: inverted ? pxPosMax : pxPosMin,
						y: 0,
						width: pxRange,
						height: chartSizeMax
					};
					if (!horiz) {
						clipAttr.x = chart.plotHeight - clipAttr.x;
					}
				} else {
					clipAttr = {
						x: 0,
						y: inverted ? pxPosMax : pxPosMin,
						width: chartSizeMax,
						height: pxRange
					};
					if (horiz) {
						clipAttr.y = chart.plotWidth - clipAttr.y;
					}
				}

				/*= if (build.classic) { =*/
				/// VML SUPPPORT
				if (inverted && renderer.isVML) {
					if (axis.isXAxis) {
						clipAttr = {
							x: 0,
							y: reversed ? pxPosMin : pxPosMax,
							height: clipAttr.width,
							width: chart.chartWidth
						};
					} else {
						clipAttr = {
							x: clipAttr.y - chart.plotLeft - chart.spacingBox.x,
							y: 0,
							width: clipAttr.height,
							height: chart.chartHeight
						};
					}
				}
				/// END OF VML SUPPORT
				/*= } =*/

				if (clips[i]) {
					clips[i].animate(clipAttr);
				} else {
					clips[i] = renderer.clipRect(clipAttr);

					if (graph) {
						series['zone-graph-' + i].clip(clips[i]);
					}

					if (area) {
						series['zone-area-' + i].clip(clips[i]);
					}
				}
				// if this zone extends out of the axis, ignore the others
				ignoreZones = threshold.value > extremes.max;
			});
			this.clips = clips;
		}
	},

	/**
	 * Initialize and perform group inversion on series.group and series.markerGroup
	 */
	invertGroups: function (inverted) {
		var series = this,
			chart = series.chart,
			remover;

		function setInvert() {
			var size = {
				width: series.yAxis.len,
				height: series.xAxis.len
			};

			each(['group', 'markerGroup'], function (groupName) {
				if (series[groupName]) {
					series[groupName].attr(size).invert(inverted);
				}
			});
		}

		// Pie, go away (#1736)
		if (!series.xAxis) {
			return;
		}

		// A fixed size is needed for inversion to work
		remover = addEvent(chart, 'resize', setInvert);
		addEvent(series, 'destroy', remover);

		// Do it now
		setInvert(inverted); // do it now

		// On subsequent render and redraw, just do setInvert without setting up events again
		series.invertGroups = setInvert;
	},

	/**
	 * General abstraction for creating plot groups like series.group, series.dataLabelsGroup and
	 * series.markerGroup. On subsequent calls, the group will only be adjusted to the updated plot size.
	 */
	plotGroup: function (prop, name, visibility, zIndex, parent) {
		var group = this[prop],
			isNew = !group;

		// Generate it on first call
		if (isNew) {
			this[prop] = group = this.chart.renderer.g(name)
				.attr({
					zIndex: zIndex || 0.1 // IE8 and pointer logic use this
				})
				.add(parent);

			group.addClass('highcharts-series-' + this.index + ' highcharts-' + this.type + '-series highcharts-color-' + this.colorIndex +
				' ' + (this.options.className || ''));
		}

		// Place it on first and subsequent (redraw) calls
		group.attr({ visibility: visibility })[isNew ? 'attr' : 'animate'](this.getPlotBox());
		return group;
	},

	/**
	 * Get the translation and scale for the plot area of this series
	 */
	getPlotBox: function () {
		var chart = this.chart,
			xAxis = this.xAxis,
			yAxis = this.yAxis;

		// Swap axes for inverted (#2339)
		if (chart.inverted) {
			xAxis = yAxis;
			yAxis = this.xAxis;
		}
		return {
			translateX: xAxis ? xAxis.left : chart.plotLeft,
			translateY: yAxis ? yAxis.top : chart.plotTop,
			scaleX: 1, // #1623
			scaleY: 1
		};
	},

	/**
	 * Render the graph and markers
	 */
	render: function () {
		var series = this,
			chart = series.chart,
			group,
			options = series.options,
			// Animation doesn't work in IE8 quirks when the group div is hidden,
			// and looks bad in other oldIE
			animDuration = !!series.animate && chart.renderer.isSVG && animObject(options.animation).duration,
			visibility = series.visible ? 'inherit' : 'hidden', // #2597
			zIndex = options.zIndex,
			hasRendered = series.hasRendered,
			chartSeriesGroup = chart.seriesGroup,
			inverted = chart.inverted;

		// the group
		group = series.plotGroup(
			'group',
			'series',
			visibility,
			zIndex,
			chartSeriesGroup
		);

		series.markerGroup = series.plotGroup(
			'markerGroup',
			'markers',
			visibility,
			zIndex,
			chartSeriesGroup
		);

		// initiate the animation
		if (animDuration) {
			series.animate(true);
		}

		// SVGRenderer needs to know this before drawing elements (#1089, #1795)
		group.inverted = series.isCartesian ? inverted : false;

		// draw the graph if any
		if (series.drawGraph) {
			series.drawGraph();
			series.applyZones();
		}

/*		each(series.points, function (point) {
			if (point.redraw) {
				point.redraw();
			}
		});*/

		// draw the data labels (inn pies they go before the points)
		if (series.drawDataLabels) {
			series.drawDataLabels();
		}

		// draw the points
		if (series.visible) {
			series.drawPoints();
		}


		// draw the mouse tracking area
		if (series.drawTracker && series.options.enableMouseTracking !== false) {
			series.drawTracker();
		}

		// Handle inverted series and tracker groups
		series.invertGroups(inverted);

		// Initial clipping, must be defined after inverting groups for VML. Applies to columns etc. (#3839).
		if (options.clip !== false && !series.sharedClipKey && !hasRendered) {
			group.clip(chart.clipRect);
		}

		// Run the animation
		if (animDuration) {
			series.animate();
		}

		// Call the afterAnimate function on animation complete (but don't overwrite the animation.complete option
		// which should be available to the user).
		if (!hasRendered) {
			series.animationTimeout = syncTimeout(function () {
				series.afterAnimate();
			}, animDuration);
		}

		series.isDirty = series.isDirtyData = false; // means data is in accordance with what you see
		// (See #322) series.isDirty = series.isDirtyData = false; // means data is in accordance with what you see
		series.hasRendered = true;
	},

	/**
	 * Redraw the series after an update in the axes.
	 */
	redraw: function () {
		var series = this,
			chart = series.chart,
			wasDirty = series.isDirty || series.isDirtyData, // cache it here as it is set to false in render, but used after
			group = series.group,
			xAxis = series.xAxis,
			yAxis = series.yAxis;

		// reposition on resize
		if (group) {
			if (chart.inverted) {
				group.attr({
					width: chart.plotWidth,
					height: chart.plotHeight
				});
			}

			group.animate({
				translateX: pick(xAxis && xAxis.left, chart.plotLeft),
				translateY: pick(yAxis && yAxis.top, chart.plotTop)
			});
		}

		series.translate();
		series.render();
		if (wasDirty) { // #3868, #3945
			delete this.kdTree;
		}
	},

	/**
	 * KD Tree && PointSearching Implementation
	 */

	kdDimensions: 1,
	kdAxisArray: ['clientX', 'plotY'],

	searchPoint: function (e, compareX) {
		var series = this,
			xAxis = series.xAxis,
			yAxis = series.yAxis,
			inverted = series.chart.inverted;

		return this.searchKDTree({
			clientX: inverted ? xAxis.len - e.chartY + xAxis.pos : e.chartX - xAxis.pos,
			plotY: inverted ? yAxis.len - e.chartX + yAxis.pos : e.chartY - yAxis.pos
		}, compareX);
	},

	buildKDTree: function () {
		var series = this,
			dimensions = series.kdDimensions;

		// Internal function
		function _kdtree(points, depth, dimensions) {
			var axis,
				median,
				length = points && points.length;

			if (length) {

				// alternate between the axis
				axis = series.kdAxisArray[depth % dimensions];

				// sort point array
				points.sort(function (a, b) {
					return a[axis] - b[axis];
				});

				median = Math.floor(length / 2);

				// build and return nod
				return {
					point: points[median],
					left: _kdtree(points.slice(0, median), depth + 1, dimensions),
					right: _kdtree(points.slice(median + 1), depth + 1, dimensions)
				};

			}
		}

		// Start the recursive build process with a clone of the points array and null points filtered out (#3873)
		function startRecursive() {
			series.kdTree = _kdtree(
				series.getValidPoints(
					null,
					!series.directTouch // For line-type series restrict to plot area, but column-type series not (#3916, #4511)
				),
				dimensions,
				dimensions
			);
		}
		delete series.kdTree;

		// For testing tooltips, don't build async
		syncTimeout(startRecursive, series.options.kdNow ? 0 : 1);
	},

	searchKDTree: function (point, compareX) {
		var series = this,
			kdX = this.kdAxisArray[0],
			kdY = this.kdAxisArray[1],
			kdComparer = compareX ? 'distX' : 'dist';

		// Set the one and two dimensional distance on the point object
		function setDistance(p1, p2) {
			var x = (defined(p1[kdX]) && defined(p2[kdX])) ? Math.pow(p1[kdX] - p2[kdX], 2) : null,
				y = (defined(p1[kdY]) && defined(p2[kdY])) ? Math.pow(p1[kdY] - p2[kdY], 2) : null,
				r = (x || 0) + (y || 0);

			p2.dist = defined(r) ? Math.sqrt(r) : Number.MAX_VALUE;
			p2.distX = defined(x) ? Math.sqrt(x) : Number.MAX_VALUE;
		}
		function _search(search, tree, depth, dimensions) {
			var point = tree.point,
				axis = series.kdAxisArray[depth % dimensions],
				tdist,
				sideA,
				sideB,
				ret = point,
				nPoint1,
				nPoint2;

			setDistance(search, point);

			// Pick side based on distance to splitting point
			tdist = search[axis] - point[axis];
			sideA = tdist < 0 ? 'left' : 'right';
			sideB = tdist < 0 ? 'right' : 'left';

			// End of tree
			if (tree[sideA]) {
				nPoint1 = _search(search, tree[sideA], depth + 1, dimensions);

				ret = (nPoint1[kdComparer] < ret[kdComparer] ? nPoint1 : point);
			}
			if (tree[sideB]) {
				// compare distance to current best to splitting point to decide wether to check side B or not
				if (Math.sqrt(tdist * tdist) < ret[kdComparer]) {
					nPoint2 = _search(search, tree[sideB], depth + 1, dimensions);
					ret = (nPoint2[kdComparer] < ret[kdComparer] ? nPoint2 : ret);
				}
			}

			return ret;
		}

		if (!this.kdTree) {
			this.buildKDTree();
		}

		if (this.kdTree) {
			return _search(point,
				this.kdTree, this.kdDimensions, this.kdDimensions);
		}
	}

}); // end Series prototype
