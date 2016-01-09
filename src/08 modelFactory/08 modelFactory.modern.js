//avalon最核心的方法的两个方法之一（另一个是avalon.scan），返回一个ViewModel(VM)
avalon.vmodels = {} //所有vmodel都储存在这里
var vtree = {}
var dtree = {}
var rtopsub = /([^.]+)\.(.+)/
avalon.vtree = vtree

avalon.define = function (definition) {
    var $id = definition.$id
    if (!$id) {
        log("warning: vm必须指定$id")
    }
    var vmodel = observeObject(definition, {}, {
        pathname: $id,
        top: true
    })

    avalon.vmodels[$id] = vmodel
    return vmodel
}


function observe(definition, old, heirloom, options) {
    //如果数组转换为监控数组
    if (Array.isArray(definition)) {
        return observeArray(definition, old, heirloom, options)
    } else if (avalon.isPlainObject(definition)) {
        //如果此属性原来就是一个VM,拆分里面的访问器属性
        if (Object(old) === old) {
            var vm = reuseFactory(old, definition, heirloom, options)
            for (var i in definition) {
                if ($$skipArray[i])
                    continue
                vm[i] = definition[i]
            }
            return vm
        } else {
            //否则新建一个VM
            return observeObject(definition, heirloom, options)
        }
    } else {
        return definition
    }
}

function Component() {
}
/*
 将一个对象转换为一个VM
 它拥有如下私有属性
 $id: vm.id
 $events: 放置$watch回调与绑定对象
 $watch: 增强版$watch
 $fire: 触发$watch回调
 $active:boolean,false时防止依赖收集
 $model:返回一个纯净的JS对象
 =============================
 $skipArray:用于指定不可监听的属性,但VM生成是没有此属性的
 
 $$skipArray与$skipArray都不能监控,
 不同点是
 $$skipArray被hasOwnProperty后返回false
 $skipArray被hasOwnProperty后返回true
 */
var $$skipArray = oneObject("$id,$watch,$fire,$events,$model,$skipArray,$active")

function observeObject(definition, heirloom, options) {
    options = options || {}

    var $skipArray = {}//收集所有不可监听属性
    if (definition.$skipArray) {
        $skipArray = oneObject(definition.$skipArray)
        delete definition.$skipArray
    }
    var $computed = getComputed(definition) // 收集所有计算属性
    var $pathname = options.pathname || ""
    var $vmodel = new Component() //要返回的对象, 它在IE6-8下可能被偷龙转凤
    var $accessors = {} //用于储放所有访问器属性的定义
    var keys = {}, key, path

    for (key in definition) {
        if ($$skipArray[key])
            continue
        var val = keys[key] = definition[key]
        if (!isSkip(key, val, $skipArray)) {
            path = $pathname ? $pathname + "." + key : key
            $accessors[key] = makeObservable(path, heirloom)
        }
    }

    for (key in $computed) {
        keys[key] = definition[key]
        path = $pathname ? $pathname + "." + key : key
        $accessors[key] = makeComputed(path, heirloom, key, $computed[key])
    }

    $accessors.$model = $modelDescriptor

    Object.defineProperties($vmodel, $accessors)

    for (key in keys) {
        //对普通监控属性或访问器属性进行赋值 
        if (!(key in $computed)) {
            $vmodel[key] = keys[key]
        }
        //删除系统属性
        if (key in $skipArray) {
            delete keys[key]
        } else {
            keys[key] = true
        }
    }

    function hasOwnKey(key) {
        return keys[key] === true
    }

    hideProperty($vmodel, "$id", $pathname)
    hideProperty($vmodel, "hasOwnProperty", hasOwnKey)
    //在高级浏览器,我们不需要搞一个$accessors存放所有访问器属性的定义
    //直接用Object.getOwnPropertyDescriptor获取它们
    if (options.top === true) {
        makeFire($vmodel)
        heirloom.vm = $vmodel
    }

    for (key in $computed) {
        val = $vmodel[key]
    }

    hideProperty($vmodel, "$active", true)
    return $vmodel
}


function isComputed(val) {//speed up!
    if (val && typeof val === "object") {
        for (var i in val) {
            if (i !== "get" && i !== "set") {
                return false
            }
        }
        return typeof val.get === "function"
    }
}

function getComputed(obj) {
    if (obj.$computed) {
        delete obj.$computed
        return obj.$computed
    }
    var $computed = {}
    for (var i in obj) {
        if (isComputed(obj[i])) {
            $computed[i] = obj[i]
            delete obj[i]
        }
    }
    return $computed
}

function makeComputed(pathname, heirloom, key, value, top) {
    var old = NaN
    function get() {
        return old = value.get.call(this)
    }
    if (top)
        get.heirloom = heirloom
    return {
        get: get,
        set: function (x) {
            if (typeof value.set === "function") {
                var older = old
                value.set.call(this, x)
                var val = this[key]
                if (this.$active && (val !== older)) {
                    var vm = heirloom.vm
                    vm && $emit(vm, this, pathname.replace(vm.$id + ".", ""), val, older)
                }
            }
        },
        enumerable: true,
        configurable: true
    }
}

function isSkip(key, value, skipArray) {
    return key.charAt(0) === "$" ||
            skipArray[key] ||
            (typeof value === "function") ||
            (value && value.nodeName && value.nodeType > 0)
}

function makeObservable(pathname, heirloom) {
    var old = NaN
    function get() {
        if (this.$active) {
            //以后再处理  collectDependency(pathname, heirloom)
        }
        return old
    }
    if (top)
        get.heirloom = heirloom
    return {
        get: get,
        set: function (val) {
            if (old === val)
                return
            if (val && typeof val === "object") {
                val = observe(val, old, heirloom, {
                    pathname: pathname
                })
            }

            var older = old
            old = val

            if (this.$active) {
                var vm = heirloom.vm
                //fire a
                vm && $emit(vm, this, pathname.replace(vm.$id + ".", ""), val, older)
                if (pathname.indexOf(".*.") > 0) {
                    var arr = vm.$id.match(rtopsub)
                    var top = avalon.vmodels[ arr[1] ]
                    if (top) {
                        top && $emit(top, this, arr[2], val, older)
                    }
                }
            }
        },
        enumerable: true,
        configurable: true
    }
}

function makeFire($vmodel) {
    hideProperty($vmodel, "$events", {})
    hideProperty($vmodel, "$watch", $watch)
    hideProperty($vmodel, "$fire", function (expr, a, b) {
        if (expr.indexOf("all!") === 0) {
            var p = expr.slice(4)
            for (var i in avalon.vmodels) {
                var v = avalon.vmodels[i]
                v.$fire && v.$fire(p, a, b)
            }
        } else {
            $emit($vmodel, $vmodel, expr, a, b)
        }
    })
}


function toJson(val) {
    var xtype = avalon.type(val)
    if (xtype === "array") {
        var array = []
        for (var i = 0; i < val.length; i++) {
            array[i] = toJson(val[i])
        }
        return array
    } else if (xtype === "object") {
        var obj = {}
        for (i in val) {
            if (val.hasOwnProperty(i)) {
                var value = val[i]
                obj[i] = value && value.nodeType ? value : toJson(value)
            }
        }
        return obj
    }
    return val
}

var $modelDescriptor = {
    get: function () {
        return toJson(this)
    },
    set: noop,
    enumerable: false,
    configurable: true
}


function hideProperty(host, name, value) {
    Object.defineProperty(host, name, {
        value: value,
        writable: true,
        enumerable: false,
        configurable: true
    })
}


//监听对象属性值的变化(注意,数组元素不是数组的属性),通过对劫持当前对象的访问器实现
//监听对象或数组的结构变化, 对对象的键值对进行增删重排, 或对数组的进行增删重排,都属于这范畴
//   通过比较前后代理VM顺序实现
