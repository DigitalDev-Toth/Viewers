import { HTTP } from 'meteor/http'
// var Fs = require("fs");

class Dcm4chee{
	static test(value){
		return new Promise((resolve,reject)=>{
			if(value>100){
				resolve("Mayor  a 100");
			}
			else{
				reject("Menor a 100");
			}
		});
	}
}
var Study = {
	dicom:{
		domain:"http://latam.storage.bio/arc/",
		manager:"http://latam.storage.bio/studies/",
		defaultQueryAET:"STORAGE",
		defaultStudyInstanceUID:"1.2.3.164384",
		attr:{
			"patient":"00100010",
			"series_uid":"0020000E",
			"series_description":"0008103E",
			"sop_instances_uid":"00080018",
			"columns":"00280011",
			"rows":"00280010",
			"patient_id":"00100020"
		},
		version:function(){
			return this.domain+"version";
		},
		qidorsPatients:function(aet){
			aet = aet || this.defaultQueryAET;
			return this.domain+"aets/"+aet+"/rs/patients";
		},
		qidorsStudies:function(aet){
			aet = aet || this.defaultQueryAET;
			return this.domain+"aets/"+aet+"/rs/studies";
		},
		wadorsMetada:function(aet,studyUid){
			aet = aet || this.defaultQueryAET;
			studyUid = studyUid || this.defaultStudyInstanceUID;
			return this.domain+"aets/"+aet+"/rs/studies/"+studyUid+"/metadata";
		},
		qidorsSeries:function(aet,studyUid){
			aet = aet || this.defaultQueryAET;
			studyUid = studyUid || this.defaultStudyInstanceUID;
			return this.domain+"aets/"+aet+"/rs/studies/"+studyUid+"/series";
		},
		qidorsInstances:function(aet,studyUid,serieUid){
			aet = aet || this.defaultQueryAET;
			studyUid = studyUid || this.defaultStudyInstanceUID;
			return this.domain+"aets/"+aet+"/rs/studies/"+studyUid+"/series/"+serieUid+"/instances";
		},
		wadorsInstances:function(aet,studyUid,seriesUid,instancesUid){
			aet = aet || this.defaultQueryAET;
			studyUid = studyUid || this.defaultStudyInstanceUID;
			return this.domain+"aets/"+aet+"/rs/studies/"+studyUid+"/series/"+seriesUid+"/instances/"+instancesUid;
			/*
			/aets/{aet}/rs/studies/{StudyInstanceUID}/series/{SeriesInstanceUID}/instances/{SOPInstanceUID}
			*/
		},
		aetitle:function(uid){
			return this.manager+uid;
		},
		wadouriInstances:function(aet,studyUID,seriesUID,objectUID){
			/*
				http://latam.storage.bio:8080/dcm4chee-arc/aets/STORAGE/wado?
				requestType=WADO
				&studyUID=1.2.392.200036.9116.2.6.1.48.1221404871.1537410089.373942
				&seriesUID=1.2.392.200036.9116.2.6.1.48.1221404871.1537410127.853377
				&objectUID=1.2.392.200036.9116.2.6.1.48.1221404871.1537410127.856006
				&contentType=application/dicom
				&transferSyntax=*
			*/
			aet = aet || this.defaultQueryAET;
			studyUID = studyUID || this.defaultStudyInstanceUID;
			return this.domain+"aets/"+aet+"/wado?requestType=WADO&studyUID="+studyUID+"&seriesUID="+seriesUID+"&objectUID="+objectUID+"&imageQuality=100&contentType=application/dicom&transferSyntax=*";
		}
	},
	saveFile:function(text,pathfile){
		// pathfile = pathfile || "salida.json";
		// return new Promise(function(a,b){
		// 	Fs.writeFile(pathfile, JSON.stringify(text),function(error){
		// 		if(error){
		// 			b(error);
		// 		}
		// 		a("ok");
		// 	});
		// });
	},
	log:function(text){
		//this.saveFile(text,"salida.log");
		console.debug(text);
	},
	getAetitle:function(token){
		var that = this;
		return new Promise(function(resolve,reject){
			that.query(that.dicom.aetitle(token) )
				.then(function(info){
					if(info.hasOwnProperty("body") && info.body.hasOwnProperty("aetitle") && info.body.hasOwnProperty("uid") ){
						resolve({
							aetitle : info.body.aetitle,
							uid : info.body.uid
						});
					}
					else {
						reject([]);
					}
				})
				.catch(function(error){
					reject([]);
				});
		});
	},
	query:function(url){
		return new Promise((resolve,reject)=>{
			try{		
				HTTP.get(url,{
					content : "application/json"
				},function(error,result){
					
					if(error){

						reject({
							response : error.statusCode,
							body : error
						});

					}
					if(result.statusCode == 404 ){
						reject({
							response : error.statusCode,
							body : result
						});
					}
					var body = ( result.statusCode == 200 ) ? JSON.parse(result.content) : [] ;
					resolve({
						response : result.statusCode,
						body : body
					});	

				});
			}
			catch(Exception){
				console.error("EXCEPTION");
			}

		});
	},
	clientHttp:function(url,params){
		return new Promise(function(resolve,reject){
			Request({
				method:"GET",
				url:url,
				multipart:{
					chunked:false,
					data:[{
						"content-type":"application/json",
						body:JSON.stringify(params || [])
					}]
				}
			},function(error,response,body){
				if(error){
					reject(error);
				}
				// console.log(response.statusCode);
				body = ( response.statusCode == 200 ) ? JSON.parse(body) : [] ;
				resolve({
					body:body
				});
			});
		});
	},
	existSerie:function(serie,series){
		var result = false;
		for(var j=0;j<series.length;j++){
			if(series[j]["seriesInstanceUid"]==serie){
				result = true;
				break;
			}
		}
		return result;
	},
	existInstance:function(instance,serie,series){
		for(var j=0;j<series.length;j++){
			if(series[j]["seriesInstanceUid"]==serie){
				series[j]["instances"].push(instance);
			}
		}
	},
	quicksort2:function(array) {
	  if (array.length <= 1) {
	    return array;
	  }	

	  var pivot = array[0].seriesNumber;
	  
	  var left = []; 
	  var right = [];	

	  for (var i = 1; i < array.length; i++) {
	  	array[i].seriesNumber < pivot ? left.push(array[i]) : right.push(array[i]);
	  }	

	  return this.quicksort2(left).concat(array[0], this.quicksort2(right));
	},
	quicksort3:function(array) {
	  if (array.length <= 1) {
	    return array;
	  }	

	  var pivot = array[0].instancesNumber;
	  
	  var left = []; 
	  var right = [];	

	  for (var i = 1; i < array.length; i++) {
	  	array[i].instancesNumber < pivot ? left.push(array[i]) : right.push(array[i]);
	  }	

	  return this.quicksort3(left).concat(array[0], this.quicksort3(right));
	},
	order:function(structureJson){
		// console.warn(  this.quicksort2([1,3,2]) );
		if( structureJson.hasOwnProperty("studies") && structureJson.studies.length == 1 ){
			// console.error( "%b %b",structureJson.studies[0].hasOwnProperty("seriesList"), structureJson.studies[0].seriesList.length > 0 );
			if( structureJson.studies[0].hasOwnProperty("seriesList") && structureJson.studies[0].seriesList.length > 0 ){
				// for(var i=0;i<structureJson.studies[0].seriesList.length;i++ ){
				// 	console.error( structureJson.studies[0].seriesList[i].seriesNumber );
				// }
				
				// var tempSerie = this.quicksort2(structureJson.studies[0].seriesList );
				// structureJson.studies[0].seriesList = tempSerie;
				structureJson.studies[0].seriesList.reverse();

				for(var i=0;i<structureJson.studies[0].seriesList.length;i++ ){
					var tempInstance = structureJson.studies[0].seriesList[i].instances;
					
					tempInstance = this.quicksort3(tempInstance);
					structureJson.studies[0].seriesList[i].instances = tempInstance;		
					// structureJson.studies[0].seriesList[i].instances.reverse();
				}
			}
		}
		return structureJson;
	},
	make:function(info){
		var client = info.aetitle;
		var uid = info.uid;

		var that = Study;
		return new Promise(function(resolve,reject){
			try{
			that.query(that.dicom.wadorsMetada(client,uid))
				.then(function(data){
					var patientName = "";
					var studies = [];
					var series = [];
					var instances = [];

					for(var i=0;i<data.body.length;i++){

						patientName = data.body[i][that.dicom.attr.patient]["Value"][0]["Alphabetic"];
						patientId = data.body[i][that.dicom.attr.patient_id]["Value"][0];
						studyInstanceUid = uid;
						seriesInstanceUid = data.body[i][that.dicom.attr.series_uid]["Value"][0]; 
						studyDate = data.body[i]["00080020"]["Value"][0];
						studyTime = data.body[i]["00080030"]["Value"][0];
						seriesNumber = data.body[i]["00200011"]["Value"][0];
						instancesNumber = data.body[i]["00200013"]["Value"][0];

						// console.error( data.body[i]["00200032"]["Value"] );

						if(data.body[i][that.dicom.attr.series_description]!==undefined &&  data.body[i][that.dicom.attr.series_description].hasOwnProperty("Value")  ){
							seriesDescription = data.body[i][that.dicom.attr.series_description]["Value"][0];
						}
						else{
							seriesDescription = "-";	
						}
						if(data.body[i]["00081030"]!==undefined &&  data.body[i]["00081030"].hasOwnProperty("Value") ){
							studyDescription = data.body[i]["00081030"]["Value"][0];
						}
						else{
							studyDescription = "-";
						}

						sopInstanceUid = data.body[i][that.dicom.attr.sop_instances_uid]["Value"][0];
						columns = data.body[i][that.dicom.attr.columns]["Value"][0];
						rows = data.body[i][that.dicom.attr.rows]["Value"][0];

						// console.error( data.body[i]["52009230"] );

						if( !that.existSerie(seriesInstanceUid,series) ){
							series.push({
								seriesInstanceUid : seriesInstanceUid,
								seriesDescription : seriesDescription,
								seriesNumber : seriesNumber,
								instances : []
							});
						}
						that.existInstance({
							uid : sopInstanceUid,
							columns : columns,
							rows : rows,
							wadouri : that.dicom.wadouriInstances(client,studyInstanceUid,seriesInstanceUid,sopInstanceUid).replace("",""),
							instancesNumber : instancesNumber
						},seriesInstanceUid,series);
						
						if( i==0 ){
							studies.push({
								studyInstanceUid : studyInstanceUid,
								patientName : patientName,
								patientId : patientId,
								studyDescription : studyDescription,
								studyDate : studyDate,
								studyTime : studyTime
							});
						}
					}

					if( studies.length > 0 ){
						studies[0]["seriesList"] = series;
					}
					resolve({
						transactionId:"dicom-test",
						studies:studies
					});
				})
				.catch(function(error){
					reject(error);
				});
			}
			catch(error){
				reject(error);
			}
		});
	}
};
module.exports.dcm4chee = Dcm4chee;
module.exports.Study = Study;