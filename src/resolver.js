var exports = module.exports = {};

var _ = require('underscore');
var lib = require('./lib').lib;

var enums = require('./enums.js').enums;
var clone = require('fast-clone');

var Resolver = {

	

	setTraceLevel: function (levelName) {
		var lvl = 0;
		if (levelName) lvl = enums.TraceLevel[levelName] || 0;
		traceLevel = lvl;
	},
	/*
	 * getState
	 * time [optional] unix time, default: now
	 * returns the current state
	*/
	getState: function(data,time,externalFunctions) {
		if (!time) time = lib.currentTime();
		


		var tl = resolveTimeline(data,{
			/*
			startTime: time-1,
			endTime: time+1,
			*/ // removed filter because evaluateKeyFrames do need the whole timeline to function
		});


		var tld = developTimelineAroundTime(tl,time);
		//log(tl)
		

		var state = resolveState(tld,time);
		
		evaluateKeyFrames(state,tld);
		
		if (evaluateFunctions(state,tld,externalFunctions)) {
			// do it all again:

			state = resolveState(tld,time);
			
			evaluateKeyFrames(state,tld);
		}

		return state;

	},

	/*
	* time [optional] unix time, default: now
	* count: number, how many events we want to return
	* returns an array of the next events
	*/
	getNextEvents: function(data,time,count) {
		if (!time) time = lib.currentTime();
		if (!count) count = 10;

		var i, obj;

		var tl;
		if (_.isArray(data)) {
			tl = resolveTimeline(data);
		} else if (_.isObject(data) && data.resolved) {
			tl = data;
		}

		var tld = developTimelineAroundTime(tl,time);


		// Create a 'pseudo LLayers' here, it's composed of objects that are and some that might be...
		var LLayers = [];
		_.each(tl.resolved,function (obj) {
			LLayers.push(obj);
		});
		_.each(tl.unresolved,function (obj) {
			
			if (obj.trigger.type === enums.TriggerType.LOGICAL) {
				// we'll just assume that the object might be there when the time comes...
				LLayers.push(obj);
			}
		});

	
		var keyframes = evaluateKeyFrames({
			LLayers: LLayers,
			time: 0
		},tld);

		

		log('getNextEvents','TRACE');


		var nextEvents = [];
		var usedObjIds = {};
		var endCount = 0;
		var startCount = 0;
		for (i=0;i<tld.resolved.length;i++) {
			//if (count>0 && startCount >= count ) break;
			obj = tld.resolved[i];
			

			if (
				obj.resolved.endTime >= time || // the object has not already finished
				obj.resolved.endTime === 0 // the object has no endTime
			 ) { 
				

				if ( obj.resolved.startTime >= time ) { // the object has not started yet
					nextEvents.push({
						type: enums.TimelineEventType.START,
						time: obj.resolved.startTime,
						obj: obj
					});
					startCount++;
				}
				if (obj.resolved.endTime) {

					nextEvents.push({
						type: enums.TimelineEventType.END,
						time: obj.resolved.endTime,
						obj: obj
					});

				}
				endCount++;

				usedObjIds[obj.id] = obj;

			}
		}
		_.each(tl.unresolved,function (obj) {
			if (obj.trigger.type === enums.TriggerType.LOGICAL) {
				usedObjIds[obj.id] = obj;
			}
		});
		
		
		for (i=0; i<keyframes.length;i++) {


			var keyFrame = keyframes[i];

			

			if (keyFrame && keyFrame.parent && (keyFrame.resolved||{}).startTime ) {
				
				if ( keyFrame.resolved.startTime >= time ) { // the object has not already started
				

					obj = usedObjIds[keyFrame.parent];
					if (obj) {
						
						nextEvents.push({
							type: enums.TimelineEventType.KEYFRAME,
							time: keyFrame.resolved.startTime,
							obj: obj,
							kf: keyFrame,
						});
					}
				}
				if ( 
					keyFrame.resolved.endTime >= time
				) { 
					
					obj = usedObjIds[keyFrame.parent];
					if (obj) {
						
						nextEvents.push({
							type: enums.TimelineEventType.KEYFRAME,
							time: keyFrame.resolved.endTime,
							obj: obj,
							kf: keyFrame,
						});
					}
				}
			}

		}

		nextEvents = _.sortBy(nextEvents,function (e) {return e.time;});

		if (count>0 && nextEvents.length > count) nextEvents.splice(count); // delete the rest

		return nextEvents;


	},

	/*
	* startTime: unix time
	* endTime: unix time
	* returns an array of the events that occurs inside a window
	*/
	getTimelineInWindow: function(data,startTime,endTime) {
		var tl = resolveTimeline(data,{
			startTime: startTime,
			endTime: endTime
		});
		log('tl','TRACE');
		log(tl,'TRACE');

		return tl;
	},

	/*
	* startTime: unix time
	* endTime: unix time
	* returns an array of the events that occurs inside a window
	*/
	getObjectsInWindow: function(data,startTime,endTime) {
		var tl = resolveTimeline(data,{
			startTime: startTime,
			endTime: endTime
		});
		//log('tl','TRACE');
		//log(tl,'TRACE');

		var tld = developTimelineAroundTime(tl,startTime);
		
		//log('tld','TRACE');
		//log(tld,'TRACE');
		return tld;
	},
	/*
	* time: unix time
	* develops the provided timeline around specified time
	* This handles inner content in groups
	*/
	developTimelineAroundTime: function(tl,time) {

		var tld = developTimelineAroundTime(tl,time);
		
		//log('tld','TRACE');
		//log(tld,'TRACE');
		return tld;
	},



	// Other exposed functionality:
	/*
	* strOrExpr: a string, '1+5*3' or an expression object
	* returns a validated expression
	* {
	*    l: 1
	*    o: '+''
	*    r: {
	*          l: 5
	*          o: '*'
	*          r: 3
	*       }
	* }
	*
	*
	*/
	interpretExpression: function(strOrExpr,isLogical) {
		return interpretExpression(strOrExpr,isLogical);
	},

	decipherLogicalValue: function (str,obj,currentState,returnExpl) {
		return decipherLogicalValue(str,obj,currentState,returnExpl); 
	},
};

/*
	Resolves the objects in the timeline, ie placing the objects at their absoulte positions

	filter: {
		startTime: Number,
		endTime: Number
	}
	
*/
var resolveTimeline = function (unresolvedData,filter) {
	if (!filter) filter = {};
	if (!unresolvedData) throw 'resolveFullTimeline: parameter unresolvedData missing!';

	// check: if unresolvedData is infact a resolved timeline, then just return it:
	if (_.isObject(unresolvedData) && unresolvedData.resolved && unresolvedData.unresolved) {
		return unresolvedData;
	}

	log('resolveTimeline','TRACE');

	
	// Start resolving the triggers, i.e. resolve them into absolute times on the timeline:

	var resolvedObjects = {};
	var unresolvedObjects = [];
	var objectIds = {};

	_.each(unresolvedData,function (obj) {
		
		if (obj) {
				
			if (!obj.content) obj.content = {};

			if (!obj.id) 					throw 'resolveTimeline: an object is missing its id!';
			if (!obj.trigger) 				throw 'resolveTimeline: object "'+obj.id+'" missing "trigger" attribute!';
			if (!_.has(obj.trigger,'type')) throw 'resolveTimeline: object "'+obj.id+'" missing "trigger.type" attribute!';
			if (objectIds[obj.id]) 			throw 'resolveTimeline: id "'+obj.id+'" is not unique!';
			if (!_.has(obj,'LLayer')) 		throw 'resolveTimeline: object "'+obj.id+'" missing "LLayers" attribute!';
			
			if (!_.has(obj.content,'GLayer')) {
				obj.content.GLayer = obj.LLayer;
			}


			unresolvedObjects.push(obj);
			objectIds[obj.id] = true;
		}
	});

	
	log('======= resolveTimeline: Starting iterating... ==============','TRACE');

	var hasAddedAnyObjects = true;
	while (hasAddedAnyObjects) {
		hasAddedAnyObjects = false;

		log('======= Iterating objects...','TRACE');

		for (var i=0;i<unresolvedObjects.length;i++) {
			var obj = unresolvedObjects[i];

			if (obj) {
				log('--------------- object '+obj.id,'TRACE');
				if (!obj.resolved) obj.resolved = {};

				if (obj.disabled) obj.resolved.disabled = true;

				var triggerTime = null;
				try {
					triggerTime = resolveObjectStartTime(obj, resolvedObjects);
				} catch (e) {
					console.log(e);
					triggerTime = null;
				}
				if (triggerTime ) {
					log('resolved object '+i,'TRACE');
					
					
					var outerDuration = resolveObjectDuration(obj,resolvedObjects);
					

					if (!_.isNull(outerDuration) && !_.isNull(obj.resolved.innerDuration)) {
						
						
						resolvedObjects[obj.id] = obj;
						unresolvedObjects.splice(i,1);
						i--;
						hasAddedAnyObjects = true; // this will cause the iteration to run again
					} else {
						log('no duration','TRACE');
					}
					
				}
				//log(obj)
				log(obj,'TRACE');

			}
		}
	}


	// Now we should have resolved all resolvable objects into absolute times.
	// Any object that couldn't be resolved are left in unresolvedObjects

	



	// Next: Filter away objects not relevant to filter:
	var filteredObjects = [];
	
	
	_.each(resolvedObjects,function (obj) {

		if (!obj.parent) {

			var ok = true;

			if ( 
				filter.startTime && 
				obj.resolved.endTime !== 0 &&
				obj.resolved.endTime < filter.startTime
			) ok = false; // The object has ended before filter.startTime

			if (
				filter.endTime && 
				obj.resolved.startTime > filter.endTime
			) ok = false; // The object starts after filter.endTime
			

			if (ok) filteredObjects.push(obj);
		}
	});

	filteredObjects = _.sortBy(filteredObjects,function (obj) {return obj.resolved.startTime;});


	return {
		resolved: filteredObjects,
		unresolved: unresolvedObjects,
	};

};

var developTimelineAroundTime = function(tl,time) {
	if (!time) time = lib.currentTime();
	// extract group & inner content around a given time

	log('developTimelineAroundTime '+time,'TRACE');

	//var resolvedObjects = {};

	var tl2 = {
		resolved: [],
		groups: [],
		unresolved: tl.unresolved
	};

	var getParentTime = function (obj) {
		var time = 0;
		if (
			_.has(obj.resolved,'repeatingStartTime') && 
			!_.isNull(obj.resolved.repeatingStartTime)
		) {
			time = obj.resolved.repeatingStartTime;
		}else if (obj.resolved.startTime) time = obj.resolved.startTime;

		if (obj.parent) time += getParentTime(obj.parent);

		return time;
	};

	var developObj = function (obj,parentObj) {
		
		log('developObj','TRACE');

		var tmpObj = _.omit(obj,['parent']);
		if (tmpObj.content && tmpObj.content.objects) {
			var objects2 = [];

			_.each(tmpObj.content.objects, function (o) {
				objects2.push(_.omit(o,['parent']));
			});
			tmpObj.content.objects = objects2;
		}

		

		var objClone = clone(tmpObj);
		var parentTime = 0;

		if (parentObj) {
			parentTime = getParentTime(parentObj);
			objClone.resolved.parentId = parentObj.id;
		} else if (obj.parent) {
			parentTime = getParentTime(obj.parent);
			objClone.resolved.parentId = obj.parent.id;
		}

		objClone.resolved.innerStartTime = objClone.resolved.startTime;
		objClone.resolved.innerEndTime = objClone.resolved.endTime;

		objClone.resolved.startTime += parentTime;
		
		if (objClone.resolved.endTime) {
			objClone.resolved.endTime += parentTime;
		}
		
		
		log(objClone,'TRACE');


		if (objClone.repeating) {
			log('Repeating','TRACE');

			//var outerDuration = objClone.resolved.outerDuration; 
			var innerDuration = objClone.resolved.innerDuration;

			if (!innerDuration) throw 'Object "#'+objClone.id+'" is repeating but missing innerDuration!';


			log('time: '+time,'TRACE');
			log('innerDuration: '+innerDuration,'TRACE');

			var repeatingStartTime = Math.max(objClone.resolved.startTime, time - ((time-objClone.resolved.startTime) % innerDuration) ); // This is the startTime closest to, and before, time

			log('repeatingStartTime: '+repeatingStartTime,'TRACE');

			objClone.resolved.repeatingStartTime = repeatingStartTime;


		}


		if (obj.isGroup) {
			_.each(obj.content.objects,function (child) {
				if (!child.parent) child.parent = obj;
				developObj(child,objClone);
			});

			tl2.groups.push(objClone);
		} else {
			tl2.resolved.push(objClone);
		}

	};

	_.each(tl.resolved,function (obj) {
		//resolveObjectStartTime(obj,resolvedObjects);
		//resolveObjectDuration(obj,resolvedObjects);

		developObj(obj);
	});

	return tl2;

};


var resolveObjectStartTime = function (obj, resolvedObjects) {
	// recursively resolve object trigger startTime
	if (!obj.resolved) obj.resolved = {};

	if (obj.trigger.type === enums.TriggerType.TIME_ABSOLUTE) {

		if (obj.parent) throw 'Trigger type TIME_ABSOLUTE not allowed inside groups!';

		// Easy, return the absolute time then:
		obj.resolved.startTime = obj.trigger.value;

	} else if (obj.trigger.type === enums.TriggerType.TIME_RELATIVE) {
		// ooh, it's a relative time! Relative to what, one might ask? Let's find out:

		if ( !_.has(obj.resolved,'startTime') || _.isNull(obj.resolved.startTime) ) {
			var o = decipherTimeRelativeValue(obj.trigger.value, resolvedObjects);
			obj.resolved.startTime = (o ? o.value : null);
			obj.resolved.referralIndex = (o ? o.referralIndex : null);
			obj.resolved.referredObjectIds = (o ? o.referredObjectIds : null);

			if (o && o.referredObjectIds) {
				_.each(o.referredObjectIds,function (ref) {
					var refObj = resolvedObjects[ref.id];
					if (refObj) {
						if (refObj.resolved.disabled) obj.resolved.disabled = true;
					}
				});
			}
		}
	}
	
	resolveObjectEndTime(obj);

	return obj.resolved.startTime;

};
var resolveObjectDuration = function (obj,resolvedObjects) {
	// recursively resolve object duration


	if (!obj.resolved) obj.resolved = {};

	if (obj.isGroup) {
		
		if (!_.has(obj.resolved,'outerDuration') ) {

			log('RESOLVE GROUP DURATION','TRACE');
			var lastEndTime = -1;
			var hasInfiniteDuration = false;
			_.each(obj.content.objects, function (child) {
				if (!child.parent) child.parent = obj;

				if (!child.resolved) child.resolved = {};

				var startTime = resolveObjectStartTime(child,resolvedObjects);
				var outerDuration = resolveObjectDuration(child,resolvedObjects);
				if (!_.isNull(startTime) && !_.isNull(outerDuration) && !_.isNull(child.resolved.innerDuration) ) {
					resolvedObjects[child.id] = child;
				}

				
				log(child,'TRACE');

				if (child.resolved.endTime === 0) hasInfiniteDuration = true;
				if (child.resolved.endTime > lastEndTime) lastEndTime = child.resolved.endTime;
			});
			

			
			if (hasInfiniteDuration) {
				lastEndTime = 0;
			} else {
				if (lastEndTime === -1) lastEndTime = null;
			}
			obj.resolved.innerDuration = lastEndTime;


			obj.resolved.outerDuration = (
				obj.duration > 0 || obj.duration === 0 ?
				obj.duration : 
				lastEndTime
			);
			

			log('GROUP DURATION: '+obj.resolved.innerDuration+', '+obj.resolved.outerDuration,'TRACE');
			
		}


	} else {

		var contentDuration = (obj.content||{}).duration;


		obj.resolved.outerDuration = (
			obj.duration > 0 || obj.duration === 0 ? 
			obj.duration : 
			contentDuration
		);

		obj.resolved.innerDuration = (
			contentDuration > 0 || contentDuration === 0 ?
			contentDuration : 
			obj.duration
		);
	}

	resolveObjectEndTime(obj); // don't provide resolvedObjects here, that might cause an infinite loop

	return obj.resolved.outerDuration;


};

var resolveObjectEndTime = function (obj, resolvedObjects) {
	if (!obj.resolved) obj.resolved = {};

	if (!_.has(obj.resolved,'startTime') && resolvedObjects) {
		resolveObjectStartTime(obj, resolvedObjects);
	}
	if (!_.has(obj.resolved,'outerDuration') && resolvedObjects) {
		resolveObjectDuration(obj, resolvedObjects);
	}

	if (
		_.has(obj.resolved,'startTime') &&
		_.has(obj.resolved,'outerDuration') &&
		!_.isNull(obj.resolved.startTime) &&
		!_.isNull(obj.resolved.outerDuration)
	) {
		if (obj.resolved.outerDuration) {
			obj.resolved.endTime = obj.resolved.startTime + obj.resolved.outerDuration;
		} else {
			obj.resolved.endTime = 0; // infinite
		}
	}
	return obj.resolved.endTime;
};

var interpretExpression = function (strOrExpr,isLogical) {
	
	// note: the order is the priority!
	var operatorList = ['+','-','*','/'];
	if (isLogical) {
		operatorList = ['&','|'];
	}

	var wordIsOperator = function (word) {
		if (operatorList.indexOf(word) !== -1) return true;
		return false;
	};
	var regexpOperators = '';
	_.each(operatorList,function (o) {
		regexpOperators += '\\'+o;
	});
	

	var expression = null;


	if (strOrExpr) {

		if (_.isString(strOrExpr)) {

			var str = strOrExpr;
			// Prepare the string:
			// Make sure all operators (+-/*) have spaces between them
			

			
			//str = str.replace(/([\(\)\*\/+-])/g,' $1 ')
			//log(str)
			//log(new RegExp('(['+regexpOperators+'])','g'));
			str = str.replace(new RegExp('(['+regexpOperators+'\\(\\)])','g'),' $1 '); // Make sure there's a space between every operator & operand
			

			
			var words = _.compact(str.split(' '));

			if (words.length === 0) return null; // empty expression

			// Fix special case: a + - b 
			for (var i = words.length-2; i>= 1; i--)  {
				if ( ( words[i] === '-' || words[i] === '+') && wordIsOperator(words[i-1]) ) {
					words[i] = words[i]+words[i+1];
					words.splice(i+1,1);
				}
			}
			// wrap up parentheses:
			var wrapInnerExpressions = function (words) {
				for (var i=0; i<words.length;i++) {

					//if (words[i] == ')') throw 'decipherTimeRelativeValue: syntax error: ')' encountered.';
					
					if (words[i] === '(') {
						var tmp = wrapInnerExpressions(words.slice(i+1));

						// insert inner expression and remove tha
						words[i] = tmp.inner;
						words.splice(i+1,tmp.inner.length+1);


					}

					if (words[i] === ')') {
						return {
							inner: words.slice(0,i),
							rest: words.slice(i+1),
						};
					}
				}
				return {
					inner: words,
					rest: []
				};
			};

			var tmp = wrapInnerExpressions(words);
			
			if (tmp.rest.length) throw 'interpretExpression: syntax error: parentheses don\'t add up in "'+str+'".';

			var expressionArray = tmp.inner;

			if (expressionArray.length % 2 !== 1) throw 'interpretExpression: operands & operators don\'t add up: "'+expressionArray.join(' ')+'".';

			var getExpression = function (words) {
				
				if (!words || !words.length) throw 'interpretExpression: syntax error: unbalanced expression';
				
				if (words.length === 1 && _.isArray(words[0])) words = words[0];

				if (words.length === 1) return words[0];

				// priority order:  /, *, -, +

				var operatorI = -1;

				/*if (operatorI == -1) {
					
					for (var i in words) {
						if (words[i] == '+' || words[i] == '-') {
							operatorI = parseInt(i);
							break;
						}
					}
				}
				if (operatorI == -1) operatorI = words.indexOf('*');
				if (operatorI == -1) operatorI = words.indexOf('/');
				*/
				_.each(operatorList,function (operator) {
					if (operatorI === -1) {
						operatorI = words.indexOf(operator);
					}
				});


				
				if (operatorI !== -1) {
					var o = {
						l: words.slice(0,operatorI),
						o: words[operatorI],
						r: words.slice(operatorI+1),
					};
					o.l = getExpression(o.l);
					o.r = getExpression(o.r);

					return o;
				} else throw 'interpretExpression: syntax error: operator not found: "'+(words.join(' '))+'"';
			};

			expression = getExpression(expressionArray);
		} else if (_.isObject(strOrExpr)) {

			
			expression = strOrExpr;

		}

		
	}

	// is valid expression?
	
	var validateExpression = function (expr,breadcrumbs) {
		if (!breadcrumbs) breadcrumbs = 'ROOT';
		

		if (_.isObject(expr)) {
			if (!_.has(expr,'l')) throw 'validateExpression: "+breadcrumbs+".l missing';
			if (!_.has(expr,'o')) throw 'validateExpression: "+breadcrumbs+".o missing';
			if (!_.has(expr,'r')) throw 'validateExpression: "+breadcrumbs+".r missing';

			if (!_.isString(expr.o)) throw 'validateExpression: "+breadcrumbs+".o not a string';

			if (!wordIsOperator(expr.o)) throw breadcrumbs+'.o not valid: "'+expr.o+'"';
			
			validateExpression(expr.l,breadcrumbs+'.l');
			validateExpression(expr.r,breadcrumbs+'.r');
		}
	};

	try {
		validateExpression(expression);
	} catch (e) {
		var errStr = JSON.stringify(expression);
		throw errStr+' '+e;
	}

	log('expression:','TRACE');
	log(expression,'TRACE');
	/*
		Example:
		expression = {
			l: '#asdf.end'  // left operand
			o: 	'+'			// operator
			r: '2'			// right operand
		}
		expression = {
			l: '#asdf.end'
		}
		expression = {
			l: '#asdf.end'
			o: 	'+'
			r: {
				l: 1
				o: *
				r: 2
			}
		}
	*/
	return expression;
};

var decipherTimeRelativeValue = function (str,resolvedObjects) {
	// Decipher a value related to the trigger type TIME_RELATIVE
	// Examples:
	// #asdf.end -2 // Relative to object asdf's end (plus 2 seconds)

	log('decipherTimeRelativeValue','TRACE');

	var referralIndex = 0;

	try {
		

		var touchedObjectExpressions = {};
		var touchedObjectIDs = [];

		var expression = interpretExpression(str);
		
		
	
		

		

		// resolve expression
		var resolveExpression = function (expression) {
			// todo:
			

			if (_.isObject(expression)) {
				
				log('resolveExpression','TRACE');

				var l = resolveExpression(expression.l);
				var r = resolveExpression(expression.r);

				log('l: '+l,'TRACE');
				log('o: '+expression.o,'TRACE');
				log('r: '+r,'TRACE');

				if (_.isNull(l)) return null;
				if (_.isNull(r)) return null;

				if (expression.o === '+') return l+r;
				if (expression.o === '-') return l-r;
				if (expression.o === '*') return l*r;
				if (expression.o === '/') return l/r;
			} else {

				if (isNumeric(expression)) return parseFloat(expression);

				if (expression[0] === '#') { // Referring to an other object: '#id-of-object'

					

					if (_.has(touchedObjectExpressions,expression)) return touchedObjectExpressions[expression]; // to improve performance and avoid circular dependencies
					touchedObjectExpressions[expression] = null; // to avoid circular dependencies
					

					//

					var words = expression.slice(1).split('.');
					var hook = 'end';
					if (words.length === 2) {
						hook = words[1];
					}

					touchedObjectIDs.push({
						id: words[0],
						hook: hook
					});

					var obj = resolvedObjects[words[0]];
					if (!obj) {
						log('obj "'+words[0]+'" not found','TRACE');
						return null;
					}

					var referredObjValue = (
						_.has(obj.resolved,'startTime') ?
						obj.resolved.startTime :
						resolveObjectStartTime(obj,resolvedObjects)
					);

					var obj_referralIndex = ((obj.resolved||{}).referralIndex || 0) + 1 ;
					if (obj_referralIndex > referralIndex) referralIndex = obj_referralIndex;
					

					var val = null;
					if (hook === 'start') {
						val = referredObjValue;
					} else if (hook === 'end') {
						val = referredObjValue + obj.resolved.outerDuration;
					} else if (hook === 'duration') {
						val = obj.resolved.outerDuration;
					} else {
						throw 'Unknown hook: "'+expression+'"';
					}
					

					touchedObjectExpressions[expression] = val;

					
					return val;
				}
			}
			return null;
			
		};

		return {
			value: resolveExpression(expression),
			referralIndex: referralIndex,
			referredObjectIds: touchedObjectIDs
		};


	} catch(e) {
		console.log('error in expression:');
		throw e;
	}

};
var decipherLogicalValue = function (str,obj,currentState,returnExpl) {
	// Decipher a value related to the trigger type TIME_RELATIVE
	// Examples:
	/* Examples: 
		'#asdf'		// id of object
		'$L1'		// special: LLayer 1 is not empty
		'$L'		// same LLayer as object
		'$G1'		// special: GLayer 1 is not empty
		'$G'		// same LLayer as object
		'.main'		// reference to a class (.classes)

		'$L.main'	// class main on LLayer
		'$L3#asdf'	// id asdf main on LLayer 3

		'.main & .second' // AND
		'.main | .second' // OR
		'.main | !.second' // OR NOT
	*/
	/*
		currentState: {
			GLayers: GLayers,
			LLayers: LLayers
		}

	*/


	

	log('decipherTimeRelativeValue','TRACE');

	//var referralIndex = 0;

	try {
		

		//var touchedObjectExpressions = {};
		//var touchedObjectIDs = [];

		var expression = interpretExpression(str,true);
		
		
	
		

		

		// resolve expression
		var resolveExpression = function (expression,obj,returnExpl) {
			// todo:
			

			if (_.isObject(expression)) {
				
				log('resolveExpression','TRACE');

				var l = resolveExpression(expression.l,obj,returnExpl);
				var r = resolveExpression(expression.r,obj,returnExpl);

				log('l: '+l,'TRACE');
				log('o: '+expression.o,'TRACE');
				log('r: '+r,'TRACE');

				if (_.isNull(l) || _.isNull(r) ) {
					if (returnExpl) return '-null-';
					return null;
				} 

				if (expression.o === '&') {
					if (returnExpl) return l+' and '+r;
					return l && r;
				}
				if (expression.o === '|') {
					if (returnExpl) return l+' and '+r;
					return l || r;
				}
				
			} else if(_.isString(expression)) {

				

				var m = expression.match(/!/g);
				var invert = (m ? m.length : 0) % 2;

				var str = expression.replace(/!/g,'');

				var value = (function(str,obj,returnExpl) {
					if (isNumeric(str)) return !!parseInt(str);


					var m = null;

					var tmpStr = str.trim();

					if (
						tmpStr === '1' ||
						tmpStr.toLowerCase() === 'true'
					) {
						return true;
					} else if (
						tmpStr === '0' ||
						tmpStr.toLowerCase() === 'false'
						) {
						return false;
					}

					var filterAdd = [];
					var filterRemove = [];
					var objsToCheck = [];
					for (var i=0;i<10;i++) {

						m = tmpStr.match(/^([#\$\.])([^#\$\. ]+)(.*)/) ; // '$L12', '$L', '$G123.main#asdf'
						
						if (m) {
							if (
								m[1] === '$'	// Referring to a layer
							) { 
								filterAdd.push({
									t: m[1],
									val: m[2]
								});
							} else if (
								m[1] === '#' ||	// Referring to an other object: '#id-of-object'
								m[1] === '.'	// Referring to a class of objects
							) { 
								filterRemove.push({
									t: m[1],
									val: m[2]
								});
							}
							tmpStr = m[3].trim();
						} else {
							break;
						}
					}

					var err = '';
					var explAdd = [];
					var explRemove = [];

					if (filterAdd.length) {
						//log('filterAdd')
						//log(filterAdd)
						_.each(filterAdd,function (add) {
							var m = add.val.match(/([GL])(.*)/i);
							if (m) {
								
								if (!isNumeric(m[2])) {
									err = m[2];
								}

								if ((m[1]||'').match(/L/i)) { // LLayer
									var LLayer = (
										m[2] ?
										m[2] :
										(obj||{}).LLayer
									);
									//log('obj on LL '+LLayer)
									//log(currentState.LLayers[LLayer])
									if (LLayer) {
										if (currentState && currentState.LLayers[LLayer]) {
											objsToCheck.push(currentState.LLayers[LLayer]);
										}
									}
									if (m[2]) {
										explAdd.push('LLayer '+(LLayer||'N/A'));
									} else {
										explAdd.push('my LLayer');
									}
								
								} else if ((m[1]||'').match(/G/i)) {  // GLayer
									var GLayer = (
										m[2] ?
										m[2] :
										((obj||{}).content||{GLayer: null}).GLayer 
									);
									if (GLayer) {
										if (currentState && currentState.GLayers[GLayer]) {
											objsToCheck.push(currentState.GLayers[GLayer]);
										}

									}
									if (m[2]) {
										explAdd.push('GLayer '+(GLayer||'N/A'));
									} else {
										explAdd.push('my GLayer');
									}
								} else {
									err = add.val;
								}
							} else {
								err = add.val;
							}
						});
					} else {
						// check in all layers:
						if (currentState) {

							 _.each(currentState.LLayers,function (obj/*, LLayer*/) {
								objsToCheck.push(obj);
							});
							_.each(currentState.GLayers,function (obj/*, GLayer*/) {
								objsToCheck.push(obj);
							});
						}

						explAdd.push('any layer');
					}



					var found = false;
					if (filterRemove.length) {
						found = true;
						_.each(filterRemove,function (remove) {
							var obj;
							if (remove.t === '#') { // id of an object
								explRemove.push('id "'+remove.val+'"');

								obj = _.find(objsToCheck,function (obj) {
									return obj.id === remove.val;
								});
								if (!obj) found = false;
							} else if (remove.t === '.') { // class of an object
								explRemove.push('class "'+remove.val+'"');
								obj = _.find(objsToCheck,function (obj) {
									return ((obj.classes||[]).indexOf(remove.val) !== -1);
								});
								if (!obj) found = false;
							} else {
								err = remove.t+remove.val;
								found = false;
							}

							var m = remove.val.match(/([\$\.])(.*)/);
						});
					} else {
						explRemove.push('anyting');
						if (objsToCheck.length) found = true;
					}

					var expl = explJoin(explRemove,', ',' and ')+' is playing on '+explJoin(explAdd,', ',' or ');

					if (err) throw 'Unknown logical expression: "'+str+'" ("'+err+'")';

					if (returnExpl) return expl;
					return found;
					
				})(str,obj,returnExpl);

				if (returnExpl) {
					if (invert)  return 'if not '+value;
					return 'if '+value;
				}
				
				if (invert) return !value;
				return value;

			} else {
				return !!parseInt(expression);
			}
			return null;
			
		};

		return resolveExpression(expression,obj,returnExpl);



	} catch(e) {
		console.log('error in expression:');
		throw e;
	}

};

var resolveState = function (tld,time) {
	if (!time) time = lib.currentTime();
	
	log('resolveState','TRACE');
	//log('resolveState '+time)
	var LLayers = {};
	var obj, obj2;

	for (var i=0; i<tld.resolved.length; i++) {
		
		obj = _.clone(tld.resolved[i]);

		log(obj,'TRACE');
		

		if (
			(
				obj.resolved.endTime > time ||
				obj.resolved.endTime === 0
			) && 
			obj.resolved.startTime <= time && 
			!obj.resolved.disabled
		) {
			//log(obj)
			if (!LLayers[obj.LLayer]) {
				LLayers[obj.LLayer] = obj;
			} else {
				// Priority:
				obj2 = LLayers[obj.LLayer];
				if (
					(
						(obj.priority||0) > (obj2.priority||0) 		// obj has higher priority => replaces obj2
					) || (
						(obj.priority||0) === (obj2.priority||0) &&
						obj.resolved.startTime > obj2.resolved.startTime			// obj starts later => replaces obj2
					) || (
						(obj.priority||0) === (obj2.priority||0) &&
						obj.resolved.startTime === obj2.resolved.startTime &&
						obj.resolved.referralIndex > obj2.resolved.referralIndex 	// obj has a higher referralIndex => replaces obj2
					)
				) {
					LLayers[obj.LLayer] = obj;
				}
			}
		}
	}
	

	log('LLayers:','TRACE');
	log(LLayers,'TRACE');

	var getGLayer = function (obj) {
		if (_.has(obj.content,'GLayer')) return obj.content.GLayer;
		if (obj.parent) return getGLayer(obj.parent);
		return null;
	};

	var GLayers = {};

	for (var LLayer in LLayers) {
		obj = LLayers[LLayer];
		var GLayer = getGLayer(obj)||0;
		
		if (!_.isNull(GLayer)) {

			if (!GLayers[GLayer]) {
				GLayers[GLayer] = obj;
			} else {
				// maybe add some better logic here, right now we use the LLayer index as a priority (higher LLayer => higher priority).
				obj2 = GLayers[GLayer];
				if (obj2.LLayer < obj.LLayer ) {
					GLayers[GLayer] = obj;
				}
			}
		}

	}
	log('GLayers:','TRACE');
	log(GLayers,'TRACE');


	// Logic expressions:
	var unresolvedLogicObjs = [];

	_.each(tld.unresolved,function (o) {
		if (o.trigger.type === enums.TriggerType.LOGICAL) {
			
			// ensure there's no startTime on obj

			if (o.resolved) {
				o.resolved.startTime = null;
				o.resolved.endTime = null;
				o.resolved.duration = null;
			}

			unresolvedLogicObjs.push({
				prevOnTimeline: null,
				obj: o
			});
		}
	});

	
	
	var hasChangedSomethingInIteration = true;
	var iterationsLeft = unresolvedLogicObjs.length;

	while( hasChangedSomethingInIteration && iterationsLeft-- >= 0) {
		hasChangedSomethingInIteration = false;

		_.each(unresolvedLogicObjs, function (o) {



			var onTimeLine = decipherLogicalValue(o.obj.trigger.value,o.obj,{
				GLayers: GLayers,
				LLayers: LLayers,
			});
			if (onTimeLine && !o.obj.disabled) {
				var oldLLobj = LLayers[o.obj.LLayer];

				if (
					!oldLLobj ||
					(o.obj.priority||0) > (oldLLobj.priority||0) // o.obj has higher priority => replaces oldLLobj
				) {
					LLayers[o.obj.LLayer] = o.obj;

					var GLayer = getGLayer(o.obj)||0;

					var oldGLObj = GLayers[GLayer];
					if (
						!oldGLObj ||
						oldGLObj.LLayer <= o.obj.LLayer || // maybe add some better logic here, right now we use the LLayer index as a priority (higher LLayer => higher priority)
						(
							oldLLobj && oldGLObj.id === oldLLobj.id // the old object has just been replaced
						)
					) {
						GLayers[GLayer] = o.obj;
					}
				}
				if (oldLLobj && oldLLobj.id !== LLayers[o.obj.LLayer].id) {
					// oldLLobj has been removed from LLayers
					// maybe remove it from GLayers as well?

					var GLayer = getGLayer(o.obj)||0;

					if (GLayers[GLayer].id === oldLLobj.id) {
						// yes, remove it:
						delete GLayers[GLayer];
					}
				}
			}
			if (
				(o.prevOnTimeline !== onTimeLine)
			) {
				hasChangedSomethingInIteration = true;
				
				o.prevOnTimeline = onTimeLine;
			}
		});
	}

	


	return {
		time: time,
		GLayers: GLayers,
		LLayers: LLayers,
	};
};

var evaluateKeyFrames = function(state,tld) {

	
	// prepare data
	var resolvedObjects = {};
	_.each(tld.resolved,function (obj) {
		resolvedObjects[obj.id] = obj;
	});
	
	

	var allValidKeyFrames = [];



	_.each(state.LLayers,function (obj) {

		
		//if (!obj.content.mixer) obj.content.mixer = {};
		if (!obj.resolved) obj.resolved = {};
		//obj.resolved.mixer = _.clone(obj.content.mixer);
		_.each(_.omit(obj.content,['GLayer']), function (val, key) {
			obj.resolved[key] = _.clone(val);
		});
		
		obj.resolved.templateData = _.clone(obj.content.templateData);



		if (((obj||{}).content||{}).keyframes) {

			

			var resolvedKeyFrames = [];

			var unresolvedKeyFrames = [];
			_.each(obj.content.keyframes,function (keyFrame) {
				unresolvedKeyFrames.push(keyFrame);
			});


			var resolvedObjectsInternal = _.clone(resolvedObjects);
			

			var hasAddedAnyObjects = true;
			while (hasAddedAnyObjects) {
				hasAddedAnyObjects = false;

				for (var i=0;i<unresolvedKeyFrames.length;i++) {
					var keyFrame = unresolvedKeyFrames[i];

					if (keyFrame && keyFrame.trigger) {

						keyFrame.resolved = {};
						var triggerTime = null;

						
						if (keyFrame.trigger.type === enums.TriggerType.LOGICAL) {
							var onTimeLine = decipherLogicalValue(keyFrame.trigger.value,keyFrame,state);

							if (onTimeLine) {
								triggerTime = 1;
								keyFrame.resolved.startTime = triggerTime;
							}
						} else if (keyFrame.trigger.type === enums.TriggerType.TIME_ABSOLUTE) {
							// relative to parent start time

							if (obj.resolved.startTime) {
								triggerTime = parseFloat(keyFrame.trigger.value) + obj.resolved.startTime;
							} else {
								triggerTime = (keyFrame.trigger.value ? 1 : 0);
							}
							if (triggerTime) keyFrame.resolved.startTime = triggerTime;

							

							resolveObjectEndTime(keyFrame,resolvedObjectsInternal);


							

						} else {

							resolveObjectEndTime(keyFrame,resolvedObjectsInternal);
							
							triggerTime = keyFrame.resolved.startTime;

						}
						if (triggerTime) {

							if (keyFrame.id) {
								resolvedObjectsInternal[keyFrame.id] = keyFrame;
							}
							resolvedKeyFrames.push(keyFrame);
							
							unresolvedKeyFrames.splice(i,1);
							i--;
							hasAddedAnyObjects = true; // this will cause the iteration to run again
						}

					}
				}
			}
			

			// sort keyframes in ascending order:
			resolvedKeyFrames.sort(function (a,b) {

				var as = (a.resolved||{}).startTime||0;
				var bs = (b.resolved||{}).startTime||0;

				if (as>bs) return 1;
				if (as<bs) return -1;
				return 0;
			});
			if (!obj.content) obj.content = {};
			
			
			// Apply keyframes
			_.each(resolvedKeyFrames,function (keyFrame) {
				
				var startTime = (keyFrame.resolved||{}).startTime;
				var endTime = (keyFrame.resolved||{}).endTime;
				if (
					startTime > 0 &&
					(!state.time || startTime <= state.time) &&
					(
						!endTime ||
						(!state.time || endTime > state.time) 
					)
				) {
					
					var usingThisKeyframe = false;
					
					if (keyFrame.content) {
						_.each(keyFrame.content, function (val, key) {
							
							if (_.isObject(val)) {

								if (!obj.resolved[key]) {
									obj.resolved[key] = {};
								}

								_.each(val, function (val1, attr) {
									// Apply keyframe to content:

									if (state.time) { // if no time is given, then don't apply
										//obj.resolved.mixer[attr] = val1;
										obj.resolved[key][attr] = val1;
									}
									usingThisKeyframe = true;
								});
							} else {
								obj.resolved[key] = val;
							}
						});
					}

					if (keyFrame.templateData) {

						if (_.isObject(obj.resolved.templateData) && _.isObject(keyFrame.templateData)) {

							_.extend(obj.resolved.templateData, keyFrame.templateData);
						} else {
							obj.resolved.templateData = keyFrame.templateData;
						}
						usingThisKeyframe = true;
					}

					if (usingThisKeyframe) {
						allValidKeyFrames.push(_.extend({parent: obj.id},keyFrame));
					}

				}
			});

			
		}
		

	});

	return allValidKeyFrames;

};

var evaluateFunctions = function(state, tld, externalFunctions) {
	var triggernewResolveState = false;


	if (externalFunctions && _.isObject(externalFunctions)) {

		_.each(state.LLayers,function (obj) {

			if (obj.useExternalFunctions && obj.content.resolve) {

				var fcn = externalFunctions[obj.content.resolve];

				if (fcn && _.isFunction(fcn)) {
					
					var value = fcn(obj,state,tld);

					triggernewResolveState = triggernewResolveState || value;
				}

			}

		});
	}


	return triggernewResolveState;
};

function isNumeric(num){
    return !isNaN(num);
}

//var log = console.log;
var traceLevel = enums.TraceLevel.ERRORS; // 0

//traceLevel = enums.TraceLevel.TRACE;

var log = function (str,levelName) {
	var lvl = 0;
	if (levelName) lvl = enums.TraceLevel[levelName] || 0;
	
	

	if (traceLevel >= lvl ) console.log(str);
};
var explJoin = function (arr,decimator,lastDecimator) {
	
	if (arr.length === 1) {
		return arr[0];
	} else {

		var arr0 = arr.slice(0,-1);

		return arr0.join(decimator) + lastDecimator + arr.slice(-1);
	}
};




exports.resolver = Resolver;